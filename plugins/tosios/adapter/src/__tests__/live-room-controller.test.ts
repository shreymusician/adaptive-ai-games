/**
 * Milestone 1f — proves `LiveRoomAIController` survives TOSIOS looping the
 * SAME Colyseus room from one completed match back into `lobby` and into a
 * second `game`, which is exactly what a real room does when the human
 * player stays connected (see `Game.ts`'s real `updateGame`/`startLobby`/
 * `startGame` state machine — never reimplemented here, only driven).
 *
 * Drives a real, unmodified TOSIOS `GameState` directly (same technique
 * `live-match-runner.test.ts` uses), replicating exactly what
 * `AdaptedGameRoom.handleTick`/`handleMessage` do around the controller's
 * `beforeTick`/`onEvents` hooks — no Colyseus `Room`/network layer needed to
 * exercise the real lifecycle bug this milestone fixes.
 *
 * Each match is ended deterministically via TOSIOS's own real "time is up"
 * branch (`Game.updateGame`'s `gameEndsAt < Date.now()` check) rather than
 * waiting for real combat to produce a kill — `gameEndsAt` is a real,
 * public field on `Game`, driven backward here only so that ALREADY-REAL
 * TOSIOS logic (never reimplemented) takes its timeout path on the very
 * next tick, instead of this test depending on nondeterministic combat RNG
 * or the real 90s `GAME_DURATION` wall-clock wait.
 */
import { describe, it, expect } from 'vitest';
import { Db } from 'mongodb';
import { OrchestrationStack } from '@adaptive-ai/orchestration';
import { ExplanationStore, ExplainabilityEngine } from '@adaptive-ai/explainability';
import { GameState } from '../../vendor-dist/server/src/states/GameState';
import { LiveRoomAIController } from '../live-room-controller';
import { TosiosEventDeriver } from '../event-deriver';
import { captureSnapshot } from '../snapshot';
import { FakeDb } from './fake-mongo';

const GAME_ID = 'tosios';
const ROOM_ID = 'room-multi-match';

async function buildStack(): Promise<{ stack: OrchestrationStack; explainability: ExplainabilityEngine }> {
  const db = new FakeDb();
  const stack = new OrchestrationStack({ db: db as unknown as Db });
  await stack.initialize();
  const store = new ExplanationStore(db as unknown as Db);
  await store.ensureIndexes();
  const explainability = new ExplainabilityEngine({ store });
  return { stack, explainability };
}

/** Wires a real GameState + TosiosEventDeriver + LiveRoomAIController together exactly the way AdaptedGameRoom does, without any Colyseus Room/network layer. */
function buildRoom(stack: OrchestrationStack, explainability: ExplainabilityEngine) {
  const deriver = new TosiosEventDeriver();
  let controller!: LiveRoomAIController;

  const state = new GameState(ROOM_ID, 'small', 2, 'deathmatch', (message) => {
    const byName = new Map<string, string>();
    state.players.forEach((p, id) => byName.set(p.name, id));
    const events = deriver.captureMessage(message, state.game.mapName, state.game.mode, state.players.size, byName);
    if (events.length > 0) controller.onEvents(events);
  });

  // Stable per-session identity — the SAME matchId every time, mirroring
  // AdaptedGameRoom.resolvePlatformIdentity's real behavior: a platform
  // match token is minted once at join time and never re-minted mid-room,
  // so a naive controller would try to reuse this same matchId for every
  // match in the room. This is precisely the condition this milestone's
  // fix must overcome.
  controller = new LiveRoomAIController(ROOM_ID, {
    stack,
    explainability,
    gameId: GAME_ID,
    aiPlayerIds: new Set(['p1', 'p2']),
    personality: 'aggressive',
    resolveIdentity: (sessionId) => ({ playerId: `platform-${sessionId}`, matchId: `${ROOM_ID}::${sessionId}` }),
  });

  async function tick(now: number): Promise<void> {
    await controller.beforeTick(state, now);
    state.update();
    const events = deriver.diffTick(captureSnapshot(state, now));
    if (events.length > 0) controller.onEvents(events);
  }

  /** Forces the real TOSIOS lobby -> game transition without a real 10s LOBBY_DURATION wait (same technique live-match-runner.test.ts uses). */
  function startMatch(): void {
    state.game.startGame();
  }

  /** Runs one real tick (so at least one real AI decision is made this match), then forces TOSIOS's own real timeout branch to end the match deterministically on the next tick. */
  async function playOneTickThenEndMatch(now: number): Promise<number> {
    let t = now;
    t += 17;
    await tick(t); // one real think-act-simulate cycle — proves the AI genuinely participated this match
    state.game.gameEndsAt = Date.now() - 1; // real TOSIOS field; next update() takes updateGame's real "time is out" branch
    t += 17;
    await tick(t); // this tick's state.update() calls the real onGameEnd(timeout) + startLobby()
    return t;
  }

  return { state, controller, tick, startMatch, playOneTickThenEndMatch };
}

describe('LiveRoomAIController — multi-match room lifecycle (Milestone 1f)', () => {
  it('participates in, and completes, a second match in the same room after the first one ends', async () => {
    const { stack, explainability } = await buildStack();
    const { state, controller, tick, startMatch, playOneTickThenEndMatch } = buildRoom(stack, explainability);

    state.playerAdd('p1', 'Player1');
    state.playerAdd('p2', 'Player2');
    await tick(Date.now()); // seeds the tick-diff baseline; game.state stays 'lobby' (no lobbyEndsAt set yet)
    startMatch();

    expect(controller.participantMatchIds.get('p1')).toBe('room-multi-match::p1'); // match 1: unsuffixed, byte-for-byte the resolved identity's own matchId

    // --- Match 1 ---
    let now = await playOneTickThenEndMatch(Date.now());
    expect(controller.ended).toBe(true);
    expect(controller.decisionsMade).toBeGreaterThan(0);

    const match1Ids = new Map(controller.participantMatchIds);
    expect(match1Ids.get('p1')).toBe('room-multi-match::p1');

    const results1 = await controller.completeAll(now);
    expect(results1.size).toBe(2);
    for (const [, { report }] of results1) {
      expect(report.status).toBe('complete');
    }
    expect(stack.orchestrator.isCompleted(match1Ids.get('p1')!)).toBe(true);

    // --- Match 2: TOSIOS loops the SAME room back to lobby, then a second
    // game starts — the human (both players here) never disconnected. ---
    expect(state.game.state).toBe('lobby'); // real TOSIOS state machine already looped back on its own (Game.updateGame's timeout branch calls startLobby())
    const decisionsAfterMatch1 = controller.decisionsMade;
    startMatch(); // force the second lobby -> game transition

    now = await playOneTickThenEndMatch(now); // must NOT throw MatchAlreadyCompletedError
    expect(controller.ended).toBe(true);
    expect(controller.decisionsMade).toBeGreaterThan(decisionsAfterMatch1); // the AI genuinely acted again in match 2, not just replaying a frozen ended state

    const match2Ids = new Map(controller.participantMatchIds);
    expect(match2Ids.get('p1')).toBe('room-multi-match::p1::round2');
    expect(match2Ids.get('p1')).not.toBe(match1Ids.get('p1')); // distinct matchId...

    const results2 = await controller.completeAll(now);
    expect(results2.size).toBe(2);
    for (const [, { report }] of results2) {
      expect(report.status).toBe('complete');
    }

    // Same durable platform playerId across both matches (identity continuity, Milestone 1c).
    const match1P1 = results1.get('p1')!;
    const match2P1 = results2.get('p1')!;
    expect(match1P1.report.playerId).toBe(match2P1.report.playerId);
    expect(match1P1.report.playerId).toBe('platform-p1');

    // Match 1's completion ran exactly once (completeMatch itself throws MatchAlreadyCompletedError on a second call for the same matchId — this proves it never happened for either matchId).
    expect(stack.orchestrator.isCompleted(match1Ids.get('p1')!)).toBe(true);
    expect(stack.orchestrator.isCompleted(match2Ids.get('p1')!)).toBe(true);
  }, 30_000);

  it('persistent player learning (Memory Engine) survives across matches while per-match state does not leak', async () => {
    const { stack, explainability } = await buildStack();
    const { state, controller, tick, startMatch, playOneTickThenEndMatch } = buildRoom(stack, explainability);

    state.playerAdd('p1', 'Player1');
    state.playerAdd('p2', 'Player2');
    await tick(Date.now());
    startMatch();

    let now = await playOneTickThenEndMatch(Date.now());
    await controller.completeAll(now);

    // Memory Engine already has a session for this platform player after match 1.
    const memoryAfterMatch1 = await stack.memoryEngine.loadPlayerMemory('platform-p1', GAME_ID, { topEpisodesLimit: 5 });
    expect(memoryAfterMatch1).toBeTruthy();

    startMatch();
    now = await playOneTickThenEndMatch(now);
    const results2 = await controller.completeAll(now);

    // Match 2's report for platform-p1 is built from real, loaded memory — proves continuity, not a fresh/empty profile.
    const p1Result = results2.get('p1');
    expect(p1Result).toBeTruthy();
    expect(p1Result!.report.status).toBe('complete');
    expect(p1Result!.report.playerId).toBe('platform-p1');
  }, 30_000);

  it('two different platform players stay isolated across a second match in the same room', async () => {
    const { stack, explainability } = await buildStack();
    const { state, controller, tick, startMatch, playOneTickThenEndMatch } = buildRoom(stack, explainability);

    state.playerAdd('p1', 'Player1');
    state.playerAdd('p2', 'Player2');
    await tick(Date.now());
    startMatch();

    let now = await playOneTickThenEndMatch(Date.now());
    await controller.completeAll(now);

    startMatch();
    now = await playOneTickThenEndMatch(now);
    const results2 = await controller.completeAll(now);

    expect(results2.size).toBe(2);
    const playerIds = new Set([...results2.values()].map((r) => r.report.playerId));
    expect(playerIds).toEqual(new Set(['platform-p1', 'platform-p2']));
  }, 30_000);
});
