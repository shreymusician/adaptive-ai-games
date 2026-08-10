/**
 * Phase 10B — live, networked TOSIOS server with a real AI-controlled
 * player, playable from a real browser.
 *
 * Mirrors the upstream vanilla server (`../../upstream/packages/server/src/index.ts`)
 * almost exactly — same Express + http + Colyseus `Server` shape, same
 * static-serving of the already-built client bundle — except it registers
 * `LiveAdaptedGameRoom` (this file, a thin subclass of the real
 * `AdaptedGameRoom`) instead of the vanilla `GameRoom`, and that subclass:
 *
 *   1. Wires `hooks.beforeTick`/`hooks.onEvents` to a `LiveRoomAIController`
 *      (real StrategyPlanner -> DecisionEngine -> Decision Adapter ->
 *      Explainability, on top of the real OrchestrationStack) BEFORE calling
 *      `super.onCreate(...)` — the documented way to wire `AdaptedGameRoom`'s
 *      hooks (see `adapted-game-room.ts`'s doc comment).
 *   2. Adds one server-controlled AI player (`ai-bot-1`) to the room via
 *      the real, public `state.playerAdd(...)` the instant the room is
 *      created, so a single human joining is enough to reach TOSIOS's real
 *      `waiting -> lobby -> game` transition (needs >1 player) without any
 *      change to TOSIOS's own match-lifecycle logic.
 *
 * Persistence: real MongoDB (Milestone 1b), the same database platform/api
 * uses (MONGODB_URI / MONGODB_DB_NAME, loaded from this package's own
 * .env — see .env.example). AI learning generated during a real browser
 * match now survives match completion, server restart, and browser
 * refresh, exactly like the rest of the platform's persistence.
 *

 * Known limitation of this minimal wiring: the AI controller stops acting
 * once the FIRST match in a room ends (`MatchEnded` sets its `ended` flag).
 * TOSIOS itself loops a room back to `lobby` and starts additional matches
 * automatically if players stay — the AI simply goes idle for those,
 * rather than the room resetting the controller. Fine for "play one match
 * against the AI"; a real multi-match-per-room controller reset is future
 * work, not attempted here.
 *
 * Usage: node scripts/live-server.js
 * Then open http://localhost:3001 in a browser.
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const path = require('path');
const express = require('express');
const { createServer } = require('http');
const { Server } = require('colyseus');

const { Constants } = require('../vendor-dist/common/src');
const { AdaptedGameRoom } = require('../dist/index.js');
const { LiveRoomAIController } = require('../dist/index.js');
const { connectRealDb } = require('../dist/index.js');
const { OrchestrationStack } = require('@adaptive-ai/orchestration');
const { ExplanationStore, ExplainabilityEngine } = require('@adaptive-ai/explainability');

const PORT = Number(process.env.PORT || Constants.WS_PORT); // 3001 by default — matches the client's own dev-mode connection target, see plugins/tosios/upstream/packages/client's Home.tsx/Game.tsx
const GAME_ID = 'tosios';
const AI_BOT_ID = 'ai-bot-1';
const AI_BOT_NAME = 'Adaptive AI';
const PUBLIC_DIR = path.join(__dirname, '../../upstream/packages/client/public');

async function main() {
  // --- Real AI stack, shared across every room this process hosts, backed
  // by the same real MongoDB database platform/api uses (Milestone 1b). ---
  const { db, client: mongoClient } = await connectRealDb();
  console.log('[live-server] connected to MongoDB');
  const stack = new OrchestrationStack({ db });
  await stack.initialize();
  const explanationStore = new ExplanationStore(db);
  await explanationStore.ensureIndexes();
  const explainability = new ExplainabilityEngine({ store: explanationStore });

  class LiveAdaptedGameRoom extends AdaptedGameRoom {
    onCreate(options) {
      const controller = new LiveRoomAIController(this.roomId, {
        stack,
        explainability,
        gameId: GAME_ID,
        aiPlayerIds: new Set([AI_BOT_ID]),
        personality: 'aggressive',
      });
      this._aiController = controller;

      this.hooks = {
        beforeTick: (state, now) => controller.beforeTick(state, now),
        onEvents: (events) => {
          controller.onEvents(events);
          if (controller.ended) {
            const now = Date.now();
            controller.completeAll(now).catch((err) => {
              console.error(`[live-server] room=${this.roomId} completeAll failed`, err);
            });
          }
        },
      };

      super.onCreate(options); // real, unmodified TOSIOS room setup — builds state, registers move/rotate/shoot dispatch, starts the real 60Hz simulation loop

      this.state.playerAdd(AI_BOT_ID, AI_BOT_NAME); // real, public API — the same method a human's onJoin calls
      console.log(`[live-server] room=${this.roomId} created — AI player "${AI_BOT_NAME}" added, waiting for a human to join`);
    }

    onLeave(client) {
      super.onLeave(client);
      console.log(`[live-server] room=${this.roomId} player left: ${client.sessionId}`);
    }
  }

  const app = express();
  app.use(express.json());

  const httpServer = createServer(app);
  const gameServer = new Server({ server: httpServer });

  gameServer.define(Constants.ROOM_NAME, LiveAdaptedGameRoom);

  // Serve the real, unmodified TOSIOS PixiJS client — built via `yarn build`
  // in plugins/tosios/upstream (see this package's README for the exact
  // command). Same static-serving shape as the vanilla server.
  app.use(express.static(PUBLIC_DIR));
  app.get('*', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  httpServer.listen(PORT, () => {
    console.log(`[live-server] Adaptive AI + TOSIOS listening on http://localhost:${PORT}`);
    console.log(`[live-server] Open that URL in a browser, enter a name, create/join a room, and wait for "${AI_BOT_NAME}" to be added automatically.`);
  });

  const shutdown = async (signal) => {
    console.log(`[live-server] ${signal} received, closing MongoDB connection`);
    try {
      await mongoClient.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[live-server] failed to start:', err);
  process.exitCode = 1;
});
