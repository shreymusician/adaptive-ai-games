/**
 * Phase 10B live-match driver — runs real, unmodified TOSIOS matches
 * end-to-end through the full wired Adaptive AI Engine pipeline (Event
 * ingestion -> MatchOrchestrator [Memory Engine -> Player Modeling ->
 * Pattern Recognition] -> Strategy Planner -> Decision Engine -> Decision
 * Adapter -> TOSIOS), using @adaptive-ai/tosios-adapter's LiveMatchRunner.
 *
 * Plain CommonJS against this package's own compiled `dist/` output (no
 * ts-node/tsx is installed anywhere in this monorepo — see PHASE_10B_REPORT.md
 * "Verification performed" for why this driver is plain JS, not TS).
 *
 * Persistence: an in-memory FakeDb (./fake-mongo.js), NOT a real `mongod` —
 * this sandbox has no reliable network access to download one (same
 * constraint already documented for every existing test suite in this
 * monorepo — see orchestration's own __tests__/fake-mongo.ts doc comment).
 * FakeDb implements the exact Db surface every AI-engine store touches, so
 * this is a real exercise of the real read/write code paths, just against
 * an in-process fake instead of a real MongoDB server.
 *
 * Both TOSIOS players in every match are AI-controlled (there is no human
 * input source available in this sandbox) — this demonstrates the AI
 * decision loop operating end-to-end, not human-vs-AI matchmaking.
 *
 * Usage: node scripts/run-live-match.js [matchCount]
 */
'use strict';

const { OrchestrationStack } = require('@adaptive-ai/orchestration');
const { ExplanationStore, ExplainabilityEngine } = require('@adaptive-ai/explainability');
const { GameState } = require('../vendor-dist/server/src/states/GameState');
const { LiveMatchRunner } = require('../dist/index.js');
const { FakeDb } = require('./fake-mongo.js');

const GAME_ID = 'tosios';
const MAX_TICKS = 6500; // ~110 sim-seconds at 17ms/tick — comfortably past TOSIOS's real 90s GAME_DURATION timeout, so every match reaches a real end (kill or timeout), never an artificial cutoff
const TICK_MS = 17; // matches TOSIOS's real ~16.66ms/tick (60Hz), see PHASE_10A_REPORT.md §2.6

async function runOneMatch(stack, explainability, roomId, matchIndex) {
  let runnerRef = null;
  const state = new GameState(roomId, 'small', 2, 'deathmatch', (message) => {
    if (runnerRef) runnerRef.captureMessage(message);
  });

  const runner = new LiveMatchRunner(state, roomId, {
    stack,
    explainability,
    gameId: GAME_ID,
    aiPlayerIds: new Set(['p1', 'p2']),
    personality: matchIndex % 2 === 0 ? 'aggressive' : 'defensive',
  });
  runnerRef = runner;

  state.playerAdd('p1', 'Player1');
  state.playerAdd('p2', 'Player2');
  state.update(); // waiting -> lobby (Game.updateWaiting sees >1 player)

  // `now` is anchored to real epoch ms (not sim-relative starting at 0):
  // Memory Engine's commitMatch() computes durationMs as (real epoch
  // committedAt) - (real epoch startedAt, taken from the first ingested
  // event's `ts`) — feeding it sim-relative small numbers produced a
  // nonsensical negative durationMs in an earlier version of this driver.
  // Every real client (human or AI) driving TOSIOS also acts in real epoch
  // time, so this is the correct anchoring, not a special case for AI.
  const wallClockStart = Date.now();
  let now = wallClockStart;

  // Register participants (mints each player's composite matchId) BEFORE
  // startGame() broadcasts 'start' — captureMessage needs a registered
  // participant to attribute that MatchStarted event to.
  runner.registerParticipants(now);
  state.game.startGame(); // real, public API — lobby -> game, skipping the real 10s lobby wait

  let ticks = 0;
  while (!runner.ended && ticks < MAX_TICKS) {
    now += TICK_MS;
    await runner.tick(now);
    ticks += 1;
  }
  const wallClockMs = Date.now() - wallClockStart;

  const results = await runner.completeAll(now);

  return { runner, results, ticks, simDurationMs: now - wallClockStart, wallClockMs, timedOutWithoutEnd: !runner.ended };
}

async function main() {
  const matchCount = Number(process.argv[2] || '5');

  const db = new FakeDb();
  const stack = new OrchestrationStack({ db });
  await stack.initialize();

  const explanationStore = new ExplanationStore(db);
  await explanationStore.ensureIndexes();
  const explainability = new ExplainabilityEngine({ store: explanationStore });

  console.log(`Running ${matchCount} real TOSIOS matches through the full wired pipeline...\n`);

  const matchReports = [];
  for (let i = 0; i < matchCount; i++) {
    const roomId = `live-room-${i}`;
    const report = await runOneMatch(stack, explainability, roomId, i);
    matchReports.push(report);

    const p1Report = report.results.get('p1');
    const p2Report = report.results.get('p2');
    console.log(
      `Match ${i + 1}/${matchCount} (${roomId}): ${report.ticks} ticks, ${report.simDurationMs}ms sim-time duration, ${report.wallClockMs}ms wall time, ` +
        `timedOut=${report.timedOutWithoutEnd}, decisions p1=${report.runner.decisionsMade}`
    );
    console.log(`  p1 report status=${p1Report.report.status} events=${p1Report.report.eventCount} playerModeling.updated=${p1Report.report.playerModeling ? p1Report.report.playerModeling.updated.length : 'n/a'} patternRecognition.updated=${p1Report.report.patternRecognition ? p1Report.report.patternRecognition.updated.length : 'n/a'}`);
    console.log(`  p2 report status=${p2Report.report.status} events=${p2Report.report.eventCount} playerModeling.updated=${p2Report.report.playerModeling ? p2Report.report.playerModeling.updated.length : 'n/a'} patternRecognition.updated=${p2Report.report.patternRecognition ? p2Report.report.patternRecognition.updated.length : 'n/a'}`);
  }

  console.log('\n--- Aggregate ---');
  const totalTicks = matchReports.reduce((a, r) => a + r.ticks, 0);
  const totalWallMs = matchReports.reduce((a, r) => a + r.wallClockMs, 0);
  const totalDecisions = matchReports.reduce((a, r) => a + r.runner.decisionsMade, 0);
  const totalEventsDerived = matchReports.reduce((a, r) => a + r.runner.eventsEmitted, 0);
  const totalEventsIngested = matchReports.reduce((a, r) => a + r.runner.eventsIngested, 0);
  const totalPlanningMs = matchReports.reduce((a, r) => a + r.runner.planningMsTotal, 0);
  const totalPlanningCalls = matchReports.reduce((a, r) => a + r.runner.planningCalls, 0);
  const totalDecisionMs = matchReports.reduce((a, r) => a + r.runner.decisionMsTotal, 0);

  console.log(`Total ticks simulated: ${totalTicks}`);
  console.log(`Total wall-clock time: ${totalWallMs}ms`);
  console.log(`Total canonical events derived: ${totalEventsDerived}`);
  console.log(`Total canonical events ingested into per-player memory (post room-level fan-out): ${totalEventsIngested}`);
  console.log(`Total AI decisions made: ${totalDecisions}`);
  console.log(`Total StrategyPlanner.plan() calls: ${totalPlanningCalls}, total ${totalPlanningMs}ms (avg ${(totalPlanningMs / Math.max(1, totalPlanningCalls)).toFixed(3)}ms/call)`);
  console.log(`Total DecisionEngine.decide() calls: ${totalDecisions}, total ${totalDecisionMs}ms (avg ${(totalDecisionMs / Math.max(1, totalDecisions)).toFixed(3)}ms/call)`);

  console.log('\n--- Semantic profile evolution (p1) after final match ---');
  const finalProfile = await stack.memoryEngine.getSemanticProfile('p1', GAME_ID);
  for (const dim of finalProfile) {
    console.log(`  ${dim.dimension}: value=${dim.value.toFixed(3)} confidence=${dim.confidence.toFixed(3)} samples=${dim.samples}`);
  }

  console.log('\n--- Patterns detected (p1) after final match ---');
  const finalPatterns = await stack.patternStore.getForPlayer('p1', GAME_ID);
  for (const p of finalPatterns) {
    console.log(`  ${p.patternId} [${p.state}] confidence=${p.confidence.toFixed(3)} observations=${p.observationCount}`);
  }

  console.log(`\nCollections written (FakeDb): ${[...db.collections.keys()].join(', ')}`);
  for (const [name, col] of db.collections) {
    console.log(`  ${name}: ${col.size()} documents`);
  }
}

main().catch((err) => {
  console.error('run-live-match failed:', err);
  process.exitCode = 1;
});
