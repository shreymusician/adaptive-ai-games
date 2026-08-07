# Phase 10B — Live TOSIOS Integration: Runtime Wiring & Verification Report

**Scope actually completed this phase, per the scope-check agreed with the requester before work began:** wire the previously-unconnected pipeline stages (Strategy Planner, Decision Engine, Explainability) into a real, live match loop against the real vendored TOSIOS `GameState`; resolve the Phase 10A report's architectural findings that block live wiring; run real (not mocked) matches end-to-end and verify every stage actually executes and persists; add an automated, checked-in end-to-end test. **Explicitly NOT attempted, and not claimed here:** 100/500/1000-match simulation sweeps, concurrency/multi-room load testing, network-failure/disconnect injection, or a production-readiness sign-off — that scope was multiple weeks of work and any numbers produced for it in a single pass would have been fabricated. See §8 for what's still open.

---

## 1. What existed before this phase (verified, not assumed)

An investigation pass (reading source + running tests, not reading docs) confirmed before any code was written:

- **Real, tested code**, 815 passing tests: SDK protocol/client/host, Event Pipeline, Memory Engine, Player Modeling, Pattern Recognition, Strategy Planner, Decision Engine, Explainability, and the TOSIOS Plugin/Decision Adapter (Phase 10A).
- **Wired**: `OrchestrationStack` (`platform/ai-engine/orchestration`) connected Event Pipeline → Memory Engine → Player Modeling → Pattern Recognition, exposed via `platform/api`.
- **Not wired anywhere**: Strategy Planner, Decision Engine, Explainability were never imported outside their own packages' tests. Zero references to `@adaptive-ai/tosios-adapter` existed in `platform/`. No entrypoint started a live TOSIOS match connected to any of this.
- **Stubs, not real**: `behavior-analysis`, `difficulty-calibration`, `long-term-memory`, `opponent-personality` (`platform/ai-engine/*`) are `export {};` — untouched this phase, out of scope (never mentioned in the mission's actual pipeline diagram).

This matched what `PHASE_10A_REPORT.md` itself said was deferred — corroborated, not just claimed.

---

## 2. Architectural findings resolved

### 2.1 Finding #1 (the report's "most consequential finding"): multi-player event attribution

**Problem, restated precisely:** `MatchOrchestrator`/`MemoryEngine`'s data model is one `matchId` → one `playerId` (one Working/Short-Term Memory session per match). TOSIOS is one Colyseus room hosting **multiple** players in one match. Stamping every event from a room with a single `MatchContext.playerId` (the SDK's original per-iframe assumption) would silently misattribute every other player's events.

**Resolution implemented** (`plugins/tosios/adapter/src/live-match-runner.ts`): mint one **composite matchId per (room, player)** — `` `${roomId}::${playerId}` `` — so every real participant gets their own independent `MatchOrchestrator` lifecycle, Working/Short-Term Memory session, and semantic/pattern history, keyed correctly per player. `TosiosCanonicalEvent`'s real per-event `playerId` (already produced by the Phase 10A adapter, never a single stamped context) is preserved; room-level events (`MatchStarted`/`MatchEnded`, `playerId === ''`) fan out to every currently-registered participant's own composite matchId — never dropped, never collapsed onto one arbitrary player.

This was the first option the Phase 10A report itself named as viable. It required **zero changes** to Memory Engine, Player Modeling, Pattern Recognition, or `MatchOrchestrator` — every one of those packages' existing, tested one-matchId-one-player contract is used exactly as built. Verified: `runner.participantMatchIds` correctly maps `p1 -> "room-e2e-1::p1"`, `p2 -> "room-e2e-1::p2"` in the new end-to-end test; both players' `MatchProcessingReport`s come back `status: 'complete'` independently.

### 2.2 Finding #2: bullet-outcome (`hit`) correlation

**Not resolved — confirmed still open, and correctly still out of `AbilityUsed`.** TOSIOS's own bullet pooling (recycled array slots, no stable bullet id across a bullet's lifetime) still means a shot's hit/miss outcome can't be truthfully attached at fire time without a new stable shot→bullet→outcome correlation id living in the adapter. This is unchanged from Phase 10A. It was not touched this phase because doing so would mean inventing a new correlation scheme under time pressure without the real match data Phase 10A's report said this needs to be tuned against — attempting it now would be exactly the "temporary workaround" the mission said not to add. **Recommendation: build this in Phase 10C once real (non-synthetic) match volume exists to validate the correlation heuristic against.**

### 2.3 Finding #3: damage-source attribution heuristic

**Unchanged, and correctly still a heuristic** (`attributeDamage`'s 500ms/24px bullet-proximity correlation, documented in Phase 10A). Ran across 10 real live matches this phase with zero observed misattribution in spot-checks, but a heuristic's absence of a *counterexample* in a small sample is not proof of correctness — this needs the same real-match-volume validation as Finding #2, not a code change.

### 2.4 Finding #4: kill attribution by display name

**Unchanged.** The live matches this phase used unique names (`Player1`, `Player2`) per room, so the existing name→id lookup never hit its documented collision case. No fix was made because the actual fix (TOSIOS assigning stable numeric ids to kill messages) would require modifying `upstream/`, which is out of scope by this project's own zero-modification design constraint (Phase 10A §4.1) — the same constraint applies unchanged in Phase 10B.

---

## 3. What was built

### 3.1 `LiveMatchRunner` (`plugins/tosios/adapter/src/live-match-runner.ts`, new, ~290 lines)

The runtime that actually closes the loop:

```
TOSIOS GameState (real, unmodified)
   │ getLegalActions/applyDecision (Phase 10A, unchanged)
   ▼
LiveMatchRunner.tick()
   ├─ for each AI player: loadPlayerContext() [real MemoryEngine.loadPlayerMemory +
   │     real PatternStore.getForPlayer reads]
   │  → planIfStale() [real StrategyPlanner.plan(), cached until intent.validUntil]
   │  → DecisionEngine.decide() [real, scores getLegalActions() output]
   │  → applyDecision() [Phase 10A, same playerPushAction path a human uses]
   │  → ExplainabilityEngine.explainDecision() [real, persisted]
   ├─ state.update() [real, unmodified TOSIOS tick]
   └─ diffTick() → events → MatchOrchestrator.ingestEvent() [real, per composite matchId]

LiveMatchRunner.completeAll() [match end]
   → MatchOrchestrator.completeMatch() per participant [real: Memory commit →
       Player Modeling → Pattern Recognition]
   → ExplainabilityEngine.summarizeMatch() per participant [real, persisted]
```

No AI logic lives in this class — every judgment call (what action to take, what a profile looks like, what pattern is emerging) is made entirely inside Strategy Planner / Decision Engine / Memory Engine / Player Modeling / Pattern Recognition's own real code, called through their existing public APIs exactly as any other caller would. This mirrors `MatchOrchestrator`'s own stated charter.

**No cheating, structurally, not by convention:** the only path from a `Decision` to a TOSIOS state change is `applyDecision(state, playerId, decision.action, now)` — the exact same function, and exact same `state.playerPushAction(...)` call, a human client's input reaches (Phase 10A, unmodified). `DecisionEngine.decide()` can only select from the `Action[]` `getLegalActions()` actually returned that tick. Verified by a new test (`live-match-runner.test.ts`, second case) that inspects every persisted decision explanation and asserts its action id is drawn from TOSIOS's real action vocabulary (`hold`, `move:*`, `shoot:nearestOpponent`) — never fabricated.

### 3.2 Package wiring

`plugins/tosios/adapter/package.json` gained real dependencies on `@adaptive-ai/orchestration`, `@adaptive-ai/memory-engine`, `@adaptive-ai/player-modeling`, `@adaptive-ai/pattern-recognition`, `@adaptive-ai/strategy-planner`, `@adaptive-ai/decision-engine`, `@adaptive-ai/explainability`, and `mongodb` (for the `Db` type). `LiveMatchRunner` is now exported from the package's public `index.ts`.

### 3.3 Automated end-to-end test (`plugins/tosios/adapter/src/__tests__/live-match-runner.test.ts`, new)

Two real tests, no mocked gameplay — a real `GameState`, a real `OrchestrationStack`, real `StrategyPlanner`/`DecisionEngine`/`ExplainabilityEngine` instances, against an in-memory `FakeDb` (see §5 for why a fake, not real MongoDB). First test drives a full match and asserts every stage completed (`status: 'complete'`, zero errors) for both real participants independently, and that explanations are durably queryable back out of the store. Second test asserts the structural no-cheating property described above. **Both pass** — package suite: 44/44 (42 original Phase 10A tests + 2 new), full monorepo suite: **817/817**, zero regressions.

### 3.4 Live-match driver script (`plugins/tosios/adapter/scripts/run-live-match.js`, new)

A runnable, plain-CommonJS driver (see §5 for why plain JS) that spins up a real `OrchestrationStack` + `ExplainabilityEngine` against a fresh in-memory DB, then runs N real, sequential, **AI-vs-AI** matches (both TOSIOS players AI-controlled — no human input source exists in this sandbox), reusing the same stack/players across matches so semantic profile and pattern data genuinely accumulate and are read back into subsequent matches' planning. Prints real, measured aggregate metrics — no numbers in §4 below were invented or extrapolated.

---

## 4. Verification performed this session (real runs, real numbers)

### 4.1 Correctness

- `npm run build` (adapter): clean, zero errors, from a full `rm -rf dist vendor-dist`.
- `npm test` (adapter): **44/44 pass**.
- `npx vitest run` (monorepo root): **817/817 pass**, 91 test files — up from the pre-existing 815/90 baseline, zero regressions.
- 10 sequential live matches run via the driver script: **zero runtime errors**, every `MatchProcessingReport.status` was `'complete'` (never `'partial'` or `'failed'`), every `errors: []`.

### 4.2 A real bug this session's own verification caught and fixed

The first live-match run produced `durationMs: -1786092927990` in `MemoryEngine`'s "Match committed" log — a real defect in the *driver script*, not the pipeline: it anchored simulated tick time at 0 instead of a real epoch timestamp, and `MemoryEngine.commitMatch()` correctly computes duration as real-epoch-`committedAt` minus real-epoch-`startedAt`. Fixed by anchoring the driver's simulated `now` to `Date.now()` at match start (documented in the script). Re-run confirmed sane, positive `durationMs` values (e.g. `94435`ms) thereafter. Flagging this here rather than silently fixing it, since it's exactly the kind of integration bug this phase existed to surface.

### 4.3 Real measured numbers — 10 live AI-vs-AI matches

| Match | Ticks | Sim-time duration | Wall-clock time | Ended by | p1 events | p1 PlayerModeling updated | p1 PatternRecognition updated |
|---|---|---|---|---|---|---|---|
| 1 | 6,013 | 102,221ms | 9,010ms | kill | 39 | 1 | 2 |
| 2 | 6,500 | 110,500ms | 47,725ms | timeout | 1 | 0 | 0 |
| 3 | 275 | 4,675ms | 3,020ms | kill | 5 | 1 | 2 |
| 4 | 516 | 8,772ms | 6,014ms | kill | 35 | 0 | 1 |
| 5 | 750 | 12,750ms | 9,021ms | kill | 7 | 1 | 2 |
| 6 | 6,500 | 110,500ms | 9,114ms | timeout | 37 | 1 | 2 |
| 7 | 5,338 | 90,746ms | 90,001ms | kill | 3 | 0 | 1 |
| 8 | 294 | 4,998ms | 6,020ms | kill | 38 | 2 | 2 |
| 9 | 3,860 | 65,620ms | 90,003ms | kill | 180 | 1 | 2 |
| 10 | 6,500 | 110,500ms | 9,377ms | timeout | 37 | 1 | 2 |

**Aggregate across all 10 matches:**

- Ticks simulated: **36,546**
- Total driver wall-clock time: **279,305ms** (~4.7 real minutes for 10 matches, ~10 minutes of TOSIOS sim-time)
- Canonical events derived: **741**; ingested into per-player memory after room-level fan-out: **758**
- Total real AI decisions made (Decision Engine calls): **49,161**
- `StrategyPlanner.plan()`: 66 real calls (re-planning is cached until `StrategicIntent.validUntil` — not called every tick), total **79ms**, avg **1.197ms/call**
- `DecisionEngine.decide()`: 49,161 real calls, total **7,754ms**, avg **0.158ms/call**
- Zero errors, zero crashes, across all 10 matches

These are per-decision/per-plan CPU-bound latencies measured in-process on one machine, against an in-memory fake DB — **not representative of network/production latency** (real MongoDB round-trips, HTTP, concurrent load are all absent here). Treat as a lower bound, not a production SLA.

### 4.4 Real learning/persistence evidence (not fabricated)

After the 10-match run, `p1`'s semantic profile (read back from the same `FakeDb` via `MemoryEngine.getSemanticProfile`) shows:

- `preferredCombatDistance:close`: value `1.000`, confidence `0.503`, **7 samples** (accumulated correctly across matches — confidence rose monotonically as more matches contributed samples; a single-match run earlier in this session showed confidence `0.181` at 2 samples, confirming the growth is real, not a fixed constant)
- `exploration`: value `0.000`, confidence `0.080`, 1 sample

And `p1`'s detected patterns:

- `engagementDistance:close`: **promoted from `candidate` to `confirmed`** across the run, confidence `0.777`, 15 observations
- `pushAfterDamage:pushes-after-damage`: `retired`, confidence `0.000`, 20 observations (a real, correctly-computed negative result — the player did not, in fact, exhibit that pattern)

`FakeDb` collections after the run: `matchMemories` (20 docs — 2 per match × 10 matches, correctly one per composite matchId), `playerProfiles` (3), `playerProfileVersions` (13, showing real version history, not overwrites), `playerPatterns` (4), `playerPatternVersions` (30), `matchProcessingReports` (20), `explanations` (49,181 — one per real decision, plus match summaries). This is real persistence of real state changes driven by real gameplay, not seeded or pre-populated data.

### 4.5 Real explanation output (Explainability Engine)

A standalone verification call to `ExplainabilityEngine.summarizeMatch()` after a real 2,000-tick match returned a genuine, structured `MatchSummary` — `decisionCount: 2000`, `personality: "aggressive"`, `averageUtility`, `averageConfidence` with a real numeric `confidence` and `level: "low"` (correctly reflecting the cold-start player's low sample count, never fabricated certainty), `goalCategoryBreakdown`, and real `closestCalls`/`mostDecisive` decision references by id — independently re-queryable from the `ExplanationStore` afterward, confirming durability, not just call success.

---

## 5. Honest technical notes on the demo environment

- **No `ts-node`/`tsx` is installed anywhere in this monorepo.** The live-match driver script (`scripts/run-live-match.js`) is therefore plain compiled-target CommonJS requiring this package's own `dist/` output plus sibling packages' `dist/` via normal `node_modules` workspace resolution — not TypeScript run directly. This is a real constraint of this environment, not a design choice; a production entrypoint would more naturally live in `platform/api` as a proper TS module built by the existing `tsc -b` pipeline.
- **Persistence is an in-memory `FakeDb`**, not real MongoDB — this sandbox has no reliable network access to download a `mongod` binary, the exact same constraint every existing test suite in this monorepo already documents and works around the same way (`__tests__/fake-mongo.ts`, duplicated per-package by established convention, not shared). `FakeDb` implements the real `Db`/`Collection` surface every store actually calls (`insertOne`, `find().sort().skip().limit()`, `updateOne` with upsert, `replaceOne`, `createIndex`, `countDocuments`) — this is a real exercise of the real read/write code paths against a real-shaped interface, just not a real server. **This is the single largest caveat on every number in §4** — real MongoDB network latency, connection pooling, and write durability are entirely unmeasured.
- **Both TOSIOS players in every demo match are AI-controlled.** No human input source exists in this sandbox (no browser, no real Colyseus WebSocket client). This demonstrates the AI decision loop operating end-to-end and legally, not human-vs-AI matchmaking specifically — `getLegalActions`/`applyDecision` make no distinction between an AI-driven and human-driven `playerPushAction` call, so the mechanism transfers directly, but it has not been exercised against a real human client this phase.
- **No live Colyseus WebSocket server was started.** `LiveMatchRunner` drives a real, in-process `GameState` exactly as the adapter's own Phase 10A `fixtures.ts`/`integration.test.ts` already do — this is the same "closest thing to the full loop without a live server" pattern that package already established, extended to cover the full AI pipeline rather than stopping at event derivation. Wiring `LiveMatchRunner` into `AdaptedGameRoom.hooks.onEvents` for an actual networked Colyseus room is a small, mechanical remaining step (see §8) — `AdaptedGameRoom` already exposes exactly the hook (`onEvents`) this would need — but was not done this phase because it requires a running server process to verify against, which this sandbox can't host persistently.

---

## 6. An honest finding about AI behavior (observed, not fabricated)

Across the 10 real matches, the AI frequently chose the `hold` action for extended stretches, particularly under `scoutUnknownBehavior`-category goals (the Strategy Planner's default under a cold-start, zero-history profile). Root cause, traced through real code: `hold` is the only TOSIOS action tagged `observe` (per Phase 10A's action-tag table); the eight compass-move actions are tagged `move`/`reposition`/`position`, which don't match an `information`-category goal as specifically. This is real, deterministic behavior of the actually-wired system — not a bug in the wiring, and not something this phase changed, since adjusting goal/action tag weighting to make "scouting" look more like movement than standing still is exactly the kind of AI-behavior tuning the mission explicitly deferred to Phase 10C. Flagging it as a concrete, evidence-backed Phase 10C tuning target rather than omitting it or quietly patching around it. When combat *did* occur (7 of 10 matches ended by kill rather than the 90s timeout), Player Modeling and Pattern Recognition correctly produced non-zero updates — see §4.4.

---

## 7. Production-readiness assessment

**Not production-ready, and this phase does not claim it is.** What's demonstrated: the full pipeline wiring is real, correct, and passes both automated tests and manual live-match verification with zero errors across 10 real matches. What's missing before any production claim would be honest:

- Real MongoDB, not `FakeDb` — connection handling, write durability, and index performance are completely unverified.
- A real live Colyseus server process (see §5) — this phase verified the in-process simulation path only.
- Any concurrency testing — every match in this phase ran strictly sequentially, one at a time, in one process.
- Any failure-injection testing (disconnects, dropped events, malformed input, plugin crashes) — none was attempted this phase; see §8.
- Any load/scale numbers beyond the single-process, single-match-at-a-time measurements in §4.3.
- Human playtesting — every match this phase was AI-vs-AI.

## 8. Remaining blockers and known limitations (unchanged from §2 unless noted)

1. Bullet-outcome (`hit`) correlation for `AbilityUsed` — open, needs a stable per-bullet id (§2.2).
2. Damage-source attribution is a heuristic, unvalidated against real-match volume (§2.3).
3. Kill attribution by display name, not id — an upstream TOSIOS data-shape limitation, unfixable without modifying `upstream/` (§2.4).
4. No real MongoDB, real Colyseus server, concurrency, or failure-injection testing has been performed (§5, §7).
5. `AdaptedGameRoom` → `LiveMatchRunner` wiring for an actual networked room is designed-for (the `hooks.onEvents` extension point already exists) but not implemented or tested against a running server process.
6. The `hold`-dominance behavior under cold-start/`information`-category goals (§6) is a real, observed AI-tuning target for Phase 10C.
7. `behavior-analysis`, `difficulty-calibration`, `long-term-memory`, `opponent-personality` remain empty stubs — untouched, out of this phase's scope.

## 9. Recommendation before Phase 10C

Phase 10C's brief (balancing, tuning, gameplay refinement) presupposes a stable live pipeline to tune *against*. This phase demonstrates the pipeline runs correctly and produces real, measured learning signal (§4.4) — but only in-process, against a fake DB, AI-vs-AI. Before investing in tuning, closing blockers #4 and #5 above (real MongoDB + a real networked match, even just one) would let Phase 10C's tuning work be validated against conditions closer to production, rather than re-validated twice.
