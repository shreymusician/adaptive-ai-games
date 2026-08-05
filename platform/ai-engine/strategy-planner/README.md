# @adaptive-ai/strategy-planner

Answers exactly one question:

> **"What objective should the AI pursue next?"**

It never selects a gameplay action, never interacts with a plugin, never mutates game state. Its only output is **StrategicIntent** — an abstract goal (plus a short lookahead sequence) for a future Decision Engine to translate into real, legal actions. That translation is explicitly out of scope for this phase.

Reference: `ADAPTIVE_AI_ENGINE_WHITEPAPER.md` §6 (Layer 1 — the GOAP-capable Strategy Planner), §7 (Awareness Budget), §9 (Personality).

## Status

**Phase 7 — implemented.** Event Pipeline (Phase 3), Memory Engine (Phase 4), Player Modeling (Phase 5), and Pattern Recognition (Phase 6) are complete and treated as stable — this package never modifies them, and in fact has **zero runtime dependency** on any of them (see "Independence," below).

## Independence — why this package imports nothing else in the monorepo

Every other AI-engine package in this repo depends on Memory Engine's types. This one deliberately does not. `types.ts` defines its own narrow `SemanticProfileEntry` / `PatternEntry` / `EpisodicMemoryEntry` / `MatchContext` / `PublicGameState` shapes that *mirror* what Memory Engine and Pattern Recognition already produce, rather than importing their richer domain types directly. Two reasons:

1. **The boundary is enforced by the type system.** `PlanningInputs` has exactly seven fields. There is no field a Goal could reach through to find something it shouldn't see — "never access hidden game state" is a compile-time guarantee, not a code-review convention.
2. **Zero database coupling.** This package has no dependency on `mongodb`, no store, no `initialize()` call. "Remain completely independent of gameplay execution" is true at the `package.json` level, not just architecturally.

A future orchestration wiring (out of scope here, same as the Decision Engine itself) is responsible for translating Memory Engine's/Pattern Recognition's real output into these shapes before calling `StrategyPlanner.plan()`.

## 1. Directory Tree

```
src/
  types.ts                  domain types — PlanningInputs, AbstractWorldState, StrategicIntent, etc.
  config.ts                 tunables: awareness thresholds, personality weight tables, GOAP bounds
  errors.ts / logger.ts / stats.ts
  goal.ts                   Goal interface + BaseGoal
  registry.ts               GoalRegistry (registration, dependency ordering, execution, failure isolation)
  world-state.ts             WorldStateBuilder — masked PlanningInputs -> AbstractWorldState
  awareness-budget.ts        tier computation, input masking, AwarenessUsed tracking
  personality.ts             weight resolution, exploration epsilon, seeded PRNG
  goap-planner.ts            bounded forward search over the Goal Registry
  plan-cache.ts               caching, invalidation, goal interruption
  strategy-planner.ts         the top-level orchestrator — StrategyPlanner.plan()
  goals/
    pressure-player.ts, force-movement.ts, force-reload.ts, control-space.ts,
    deny-resources.ts, create-ambush.ts, break-predictable-pattern.ts,
    scout-unknown-behavior.ts, protect-objective.ts, retreat.ts, regroup.ts,
    delay-engagement.ts, split-targets.ts, test-hypothesis.ts
    index.ts                  registerAllGoals()
  index.ts
  __tests__/
    fixtures.ts
    goal-registry.test.ts
    goals/defense.test.ts, pressure.test.ts, deception-information.test.ts
    awareness-budget.test.ts, personality.test.ts
    goap-planner.test.ts, plan-cache.test.ts
    strategy-planner.test.ts     integration + deterministic replay
    stress.test.ts                randomized planning + performance benchmarks
```

## 2. Planner Architecture

```
StrategyPlanner.plan(inputs)
      |
      v
maskPlanningInputs()  --Awareness Budget tier gates which of 7 inputs are visible
      |
      v
buildWorldState()      --masked inputs -> AbstractWorldState (symbolic facts)
      |
      v
PlanCache.get()  --cache hit? return immediately (see "Plan Caching")
      |  (miss/invalidated/interrupted)
      v
GoalRegistry.evaluateAll()  --every goal scored against current world state
      |
      v
runGoapSearch()  --bounded forward search, chains up to maxSearchDepth goals
      |
      v
StrategicIntent  --goalId + plannedSequence + confidence + full trace
      |
      v
PlanCache.set()
```

`StrategyPlanner` itself contains no AI logic — it sequences these five modules and builds the result object. Every actual judgment (is this goal eligible, how good is it, what would happen next) lives inside the Goal Registry / individual goals / GOAP search, exactly mirroring how `PlayerModelingEngine` and `PatternRecognitionEngine` are thin orchestrators over their own registries.

## 3. Goal Registry

Structurally a **third instance of the same registry pattern** already proven twice in this monorepo (`DimensionRegistry` in player-modeling, `PatternRegistry` in pattern-recognition) — deliberately not reinvented:

| Responsibility | How |
|---|---|
| Registration | `register(factory: () => Goal)`. Throws `DuplicateGoalError` on a repeated id. |
| Discovery | `list()` / `get(id)` / `has(id)`. |
| Dependencies | `executionOrder()` — Kahn's-algorithm topological sort over `metadata.dependsOn`. `UnknownGoalDependencyError` / `CyclicGoalDependencyError` on misconfiguration. None of the 14 goals in this phase declare a dependency — the mechanism exists for future goals that need one. |
| Versioning | Each goal declares `metadata.version` — an audit trail for which goal logic produced a given `PlanningTrace` entry, exactly like the other two registries' `version` field. |
| Execution ordering | `evaluateAll(ctx)` — evaluates every registered goal, in dependency order, populating `siblingResults` as it goes. |
| Failure isolation | A thrown error from any goal's `evaluate()` is caught and recorded against that goal only; every other goal still evaluates. |

**Extending the platform:** implement `Goal` (usually via `BaseGoal`) in one new file under `src/goals/`, and add one `registry.register(...)` line in `src/goals/index.ts`. No existing goal, the registry, the GOAP planner, or `StrategyPlanner` itself ever needs to change.

**The one hard rule:** `RegroupGoal` must stay registered. Its preconditions are trivially always `true` — it is the guaranteed-eligible fallback that lets the GOAP search never come back empty (`NoEligibleGoalError` only fires if a caller builds a registry without any always-eligible goal).

## 4. Implemented Goals (14)

| Goal | Category | interruptPriority | Preconditions (summary) |
|---|---|---|---|
| **Retreat** | defense | **10** (highest) | Self health low |
| **ProtectObjective** | defense | 5 | Objective threatened |
| **DelayEngagement** | tempo | 2 | Self resources low, or player aggressive with no opening |
| **PressurePlayer** | pressure | 0 | Opening available, or player health low |
| **ForceMovement** | positioning | 0 | Space contested, or objective threatened |
| **ForceReload** | tempo | 0 | Own resources fine AND (player aggressive OR known combat pattern) |
| **ControlSpace** | positioning | 0 | Space contested |
| **DenyResources** | pressure | 0 | Own resources not low (trivially eligible whenever true) |
| **CreateAmbush** | deception | 0 | Exploitable pattern known AND player not retreating |
| **BreakPredictablePattern** | deception | 0 | Player predictable (profile) OR exploitable pattern known |
| **ScoutUnknownBehavior** | information | 0 | Semantic profile thin OR fewer than 2 confirmed patterns |
| **TestHypothesis** | information | 0 | Expert awareness tier AND an exploitable pattern exists |
| **SplitTargets** | pressure | 0 | Plugin opts in via `publicGameState.extra.multipleTargets` |
| **Regroup** | defense | 0 | **Always true** — the guaranteed fallback |

Every goal independently implements exactly four things (via `BaseGoal`'s template method):
- `checkPreconditions(ctx)` — boolean, pure
- `computeUtility(ctx)` — `[0,1]` desirability + structured `reasoning`
- `computeCost(ctx)` — `[0,1]` estimated risk/resource cost
- `computeEffects(ctx)` — declarative `AbstractWorldState` patch, the GOAP effect set

No goal file is longer than ~50 lines. No goal imports another goal.

## 5. GOAP Implementation

Bounded forward search where **the registered Goals themselves are the abstract action space** (whitepaper §6: "a small ABSTRACT action space {pressure, regroup, flank, bait, defend, ...}"). Each plan step picks one goal, applies its `expectedEffects` to simulate the next `AbstractWorldState`, and re-evaluates every goal against that simulated state for the next step.

| Requirement | Implementation |
|---|---|
| **Deterministic planning** | Goal iteration order comes from `GoalRegistry`'s stable `executionOrder()`; score ties break on `goalId` (string) ascending; the only randomness anywhere (Experimental personality's exploration term) is `seededUnitRandom(seed)` — a pure function of a caller-supplied seed, never `Math.random()` or wall-clock entropy. |
| **Planning budget** | Three independent bounds, all in `config.goap`: `maxSearchDepth` (3), `nodeBudget` (60 total goal evaluations), `beamWidth` (3 — only the top-K eligible goals expand further at each level). |
| **Plan caching** | `PlanCache`, in-process `Map` keyed by `matchId` (same convention as Memory Engine's `WorkingMemoryStore`). |
| **Incremental replanning** | A cached plan is reused as-is unless something specific invalidates it — see below. Most calls in a stable situation are a cheap cache hit, not a fresh search. |
| **Goal interruption** | Goals with `interruptPriority > 0` (Retreat=10, ProtectObjective=5, DelayEngagement=2) can preempt an in-progress cached plan. Two mechanisms work together: (1) at scoring time, when any eligible goal has `interruptPriority > 0`, the GOAP search restricts consideration to only the highest-priority such goal — an urgent goal always outscores a merely-attractive one, regardless of personality weighting; (2) at the cache layer, an interrupt-capable goal only forces a replan the moment it **newly** becomes eligible compared to the previous call (a genuine state transition), never merely because it happens to still be eligible — this is what makes incremental replanning actually work instead of thrashing on every call. |
| **Plan invalidation** | A cached plan is invalidated (`checkCacheValidity`) when any of: TTL elapsed (`planTtlMs`, default 15s), the `AbstractWorldState` fingerprint changed (`fingerprintFacts` — a deterministic, key-order-independent hash), the awareness budget changed, or the personality changed. |

### A worked example of interruption

```
t=0    health=0.9  -> plan() -> "pressurePlayer" (cached)
t=200  health=0.9  -> plan() -> cache HIT, still "pressurePlayer", cheap
t=400  health=0.1  -> plan() -> world state changed (health fact) AND
                                 retreat newly eligible -> full replan ->
                                 "retreat" wins outright (interrupt override) ->
                                 interruptedGoalId: "pressurePlayer"
t=600  health=0.1  -> plan() -> cache HIT, still "retreat" (retreat was
                                 already known-eligible last time — no re-trigger)
```

## 6. Awareness Budget

Implements whitepaper §7 exactly at this layer: a `[0,1]` scalar (supplied by the caller — a future Difficulty Calibration module, never computed inside this package) gates which of the seven `PlanningInputs` categories a goal is even allowed to read.

| Tier | Budget range (default thresholds) | What's visible |
|---|---|---|
| **Beginner** | `< 0.34` | `MatchContext` + `PublicGameState` only — "what's happening right now," the whitepaper's "competent-but-generic baseline" |
| **Veteran** | `0.34 – 0.67` | + Semantic Profile |
| **Expert** | `>= 0.67` | + confirmed/strong Patterns + Episodic Memory |

`MatchContext`/`PublicGameState` are **never gated** — they're live legal public state any competent opponent would see, not the *learned* knowledge the budget exists to gate.

**Every plan explicitly records which memories influenced it** (`StrategicIntent.awarenessUsed`): not just "this tier was active" but the *specific* dimension names, pattern ids, and episode ids a goal actually read, via `readSemanticDimension()`/`readPatterns()`/`readEpisodes()` helpers every goal calls instead of touching the masked arrays directly — so the bookkeeping is automatic and can never be forgotten by an individual goal file.

## 7. Personality

Seven archetypes (the whitepaper's six, plus **Supportive** per this phase's explicit instructions): Hunter, Aggressive, Defensive, Psychological, Patient, Experimental, Supportive.

Personality is applied in **exactly one place** — `goap-planner.ts`'s `scoreCandidates()` — as `score = personalityWeight * utility - cost`, where `personalityWeight = categoryWeight[goal.category] * (goalOverride[goal.id] ?? 1)`. No `Goal.evaluate()` ever sees which personality is active; `GoalEvaluationContext` doesn't even carry it. This is a direct, load-bearing consequence of whitepaper §9: "personality should only influence planning priorities" — same facts, same utility/cost math, different weighting, different resulting choice.

| Archetype | Bias |
|---|---|
| Aggressive | pressure/tempo ↑, defense ↓ |
| Patient | defense/positioning ↑, pressure/tempo ↓ |
| Hunter | pressure/information ↑ (Scout override), positioning ↓ |
| Defensive | defense ↑↑, pressure/tempo ↓ |
| Psychological | deception/information ↑ (Ambush/BreakPattern override) |
| Experimental | neutral weights + `explorationEpsilon` (default 0.15): a seeded-random chance per plan step to deliberately promote a lower-scored eligible goal (TestHypothesis override) — the whitepaper's "controlled exploration term," a structural hedge against the AI itself becoming predictable |
| Supportive | defense/positioning ↑ (Protect/Regroup override), pressure ↓ — distinct from Defensive: about match balance, not self-preservation |

Personality **never** touches memory, never touches a player model, never appears in `PlanningInputs` — it flows in as one field, is resolved to a number, and that's the entirety of its footprint.

## 8. Structured Reasoning / Explainability Support

No natural language is generated anywhere in this package — every `StrategicIntent` carries enough structured data for a future Explainability module to produce a deterministic readout:

- `planningTrace.worldState` — every symbolic fact the decision was based on
- `planningTrace.candidates` — every goal evaluated, with utility/cost/personalityWeight/score/preconditionsMet/reasoning
- `planningTrace.rejectedEligible` — goals that qualified but lost, with their scores (the "why not X" case)
- `planningTrace.planSequence` — the chosen multi-step sequence, each step's world state before/after and score
- `awarenessUsed` — exactly which dimensions/patterns/episodes were actually read
- `planningMetadata` — search depth, nodes expanded, cache hit/replan/interruption status
- `confidence` — the normalized score margin between the winning and runner-up goal (a decisive win reads as high confidence; a close call reads as low confidence, independent of the winning goal's raw utility)

## 9. Public API

```ts
import { StrategyPlanner, GoalRegistry, registerAllGoals, loadStrategyPlannerConfig } from '@adaptive-ai/strategy-planner';

const registry = new GoalRegistry();
registerAllGoals(registry);

const planner = new StrategyPlanner({ registry, config: loadStrategyPlannerConfig() });

const intent = planner.plan({
  matchContext: { matchId, playerId, gameId, elapsedMs },
  publicGameState: { selfHealth: 0.8, openingAvailable: true },
  semanticProfile: [...],   // from Memory Engine's getSemanticProfile()
  patterns: [...],          // from Pattern Recognition's PatternStore.search()
  episodicMemory: [...],    // from Memory Engine's searchEpisodes()
  awarenessBudget: 0.6,     // from a future Difficulty Calibration module
  personality: 'aggressive',
});

// intent.goalId, intent.plannedSequence, intent.confidence,
// intent.awarenessUsed, intent.planningMetadata, intent.planningTrace
```

Also exported: `Goal`/`BaseGoal` (extension point), `PlanCache` (injectable for testing/inspection), `runGoapSearch` (standalone), `buildWorldState`/`maskPlanningInputs` (standalone), all 14 goal classes individually, and the full error hierarchy.

## 10. Test Coverage

**111 tests, all passing**, across 10 files:

| Area | File | Coverage |
|---|---|---|
| Registry | `goal-registry.test.ts` | registration, duplicates, dependency ordering, cycles, failure isolation |
| Goals | `goals/*.test.ts` (3 files) | every one of the 14 goals' preconditions/utility/cost behavior |
| Awareness Budget | `awareness-budget.test.ts` | tier computation, all 3 masking tiers (whitepaper's worked examples verbatim), per-item usage tracking |
| Personality | `personality.test.ts` | every archetype's category bias, goal overrides, exploration epsilon, seeded-PRNG determinism |
| GOAP planner | `goap-planner.test.ts` | node/depth bounds, determinism, interrupt-priority override, personality-changes-scoring |
| Plan cache | `plan-cache.test.ts` | fingerprinting, all 4 invalidation reasons, interrupt state-transition semantics |
| Integration | `strategy-planner.test.ts` | full `plan()` contract, **deterministic replay** (identical inputs -> identical decision from a fresh planner), caching/replanning/interruption end to end, awareness budget end to end |
| Stress | `stress.test.ts` | 1000 randomized planning calls (reproducible via a seeded PRNG, never flaky), reachability of all 14 goals, performance benchmarks |

## 11. Performance Benchmarks

From `src/__tests__/results/performance-results.json` (in-process, no I/O — this package has no database):

| Scenario | Result |
|---|---|
| 1000 randomized planning calls (fresh match each time — worst case, always a full replan) | 302ms total, **0.30ms average** per call |
| 200 cold (full-replan) calls | 0.18ms average, 2ms max |
| Cache-hit vs. cold | Cache hit consistently ≤ cold, both sub-millisecond |
| 500 distinct concurrent matches | 103ms total, 0.21ms per match |
| Goal reachability | All 14 registered goals won at least once across 1000 randomized inputs — no dead goal code |

Node/depth bounds hold in every run: `nodesExpanded ≤ nodeBudget + goalCount`, `searchDepthUsed ≤ maxSearchDepth` — verified directly in `goap-planner.test.ts` and `stress.test.ts`, not just claimed.

## Known Limitations

- **No real Memory Engine/Pattern Recognition wiring yet.** This package is deliberately standalone (see "Independence"); a future orchestration layer must translate real Memory Engine/Pattern Recognition output into `PlanningInputs` before `plan()` can run against live data. Not a bug — an explicit scope boundary for this phase.
- **`PlanCache` is in-process only**, same tradeoff as Memory Engine's `WorkingMemoryStore` — a process restart forgets all cached plans (every match simply does a fresh, still-correct, still-fast full replan on its next call; nothing is lost, no state was ever durable here).
- **GOAP effects are declarative but unvalidated.** A goal's `expectedEffects` are trusted at face value when simulating the next planning step — there's no check that a goal's claimed effect is physically plausible. This mirrors real GOAP implementations generally (STRIPS-style planners trust declared effects); a future goal author who declares an effect their goal doesn't actually cause would silently mislead deeper-level lookahead, though never the CHOSEN first step's correctness (only `plannedSequence`, the lookahead beyond it).
- **`interruptPriority` is a hard override, not a soft weight.** Any eligible goal with `interruptPriority > 0` completely dominates goal selection over every `interruptPriority: 0` goal, regardless of how low its own utility is. This is intentional (Retreat must never lose to a merely-attractive offensive goal) but means a badly-tuned future goal with a nonzero `interruptPriority` could dominate more often than intended — tune this field conservatively.
- **Confidence is a scoring-margin heuristic, not a calibrated probability.** `GoalConfidence` reflects "how decisive was this choice," not "how likely is this the objectively correct goal" — useful for Explainability's tone, not a statistical guarantee.
- **Cross-game generalization is out of scope here.** `PlanningInputs.semanticProfile`/`patterns` are assumed already correctly scoped (per-game vs. cross-game) by whatever caller constructs them — this package performs no cross-game rollup itself (that's whitepaper §11's concern, a different module).
