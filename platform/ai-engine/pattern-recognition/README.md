# @adaptive-ai/pattern-recognition

Discovers discrete, statistically-backed behavioral habits from match history. Answers exactly one question:

> **"What habits does this player repeatedly demonstrate?"**

It never plans, never decides, and never updates continuous player traits — those remain `strategy-planner`/`decision-engine`'s and `player-modeling`'s jobs respectively, both of which this package only ever *reads from*.

Reference: `ADAPTIVE_AI_ENGINE_WHITEPAPER.md` §5 (Pattern Recognition).

## Status

**Phase 6 — implemented.** Player Modeling (Phase 5) is complete, approved, and treated as stable/frozen — this package reads its output but never modifies it. Memory Engine (Phase 4) remains untouched.

## Boundary — inputs and outputs

**Inputs (only):**
- Event Pipeline data, via a match's `MatchMemoryRecord.recentEvents` and `.recentDecisions` (Memory Engine's Short-Term Memory)
- Player Modeling's output for the same match (`PlayerModelingRunResult`, passed directly into `processMatch`)
- Prior Semantic Memory is available implicitly through Player Modeling's output; this package does not read it directly
- Episodic Memory (`MemoryEngine.searchEpisodes`), a bounded recent window prefetched once per run
- Its own prior pattern state (`PatternStore`, this package's own persistence — see below)

**Outputs (only):**
- Confirmed behavioral patterns (`PatternRecord`)
- Pattern confidence scores (`PatternRecord.confidence`, plus the full `(observationCount, supportingEvidence)` evidence backing it)
- Pattern metadata (`PatternRecord.metadata`, `PatternDetectorMetadata`)
- Pattern history (`PatternVersion`, append-only, queryable via `getHistory`)
- Pattern promotion/demotion events (`PatternRecognitionRunResult.promotions`/`.demotions`)

**Persistence boundary — why this package has its own store.** Memory Engine (Phase 4) implements exactly four whitepaper-defined per-player memory components (Working/Short-Term/Semantic/Episodic) and has no pattern-specific collection. `PLATFORM_V2_DESIGN.md` §6 flags `playerPatterns` as Pattern Recognition's own output collection — never built in Phase 4, and this phase's instructions are explicit that Memory Engine must not be modified except for integration bug fixes. `PatternStore` (`pattern-store.ts`) therefore owns its own `playerPatterns`/`playerPatternVersions` collections directly, via the same `Db` dependency-injection shape Memory Engine's own stores use — a new, additive capability, not a change to an existing one. Every detector *input* still comes exclusively through Memory Engine's and Player Modeling's own public APIs.

## Architecture

```
PatternRecognitionEngine
      |
      v
PatternRegistry
      |
      v
Pattern Detector  (x18, one per habit, isolated)
      |
      v
PatternStore  (this package's own persistence for its own output)
```

- **PatternRecognitionEngine** (`pattern-recognition-engine.ts`) — the orchestrator: load memory → replay match events → execute detectors → update pattern confidence → commit pattern updates.
- **PatternRegistry** (`registry.ts`) — detector registration, dependency ordering, versioning, discovery, execution, failure isolation. Structurally a direct parallel to `player-modeling`'s `DimensionRegistry`, operating on `PatternDetector` instead of `DimensionAnalyzer`.
- **PatternDetector** (`detector.ts`) — the standard interface every pattern type implements, in complete isolation from every other detector.

## Directory tree

```
src/
  types.ts                      domain types
  config.ts                     tunables (k, thresholds, decay rates, bucket edges) per detector
  confidence.ts                 the pattern confidence model (volume x concentration + asymmetric decay)
  lifecycle.ts                  the 6-state lifecycle machine
  detector.ts                   PatternDetector interface + BasePatternDetector
  registry.ts                   PatternRegistry
  pattern-store.ts              persistence: playerPatterns / playerPatternVersions, search API, dormancy sweep
  pattern-recognition-engine.ts the MatchEnded orchestrator
  errors.ts / logger.ts / stats.ts
  detectors/
    movement/    dodge-direction.ts, escape-routes.ts, corner-preference.ts, circle-strafing.ts
    combat/      reload-timing.ts, target-prioritization.ts, engagement-distance.ts, weapon-preference.ts
    decision/    retreat-conditions.ts, healing-timing.ts, ability-usage-timing.ts, resource-conservation.ts
    exploration/ route-preference.ts, room-clearing.ts, exploration-order.ts
    risk/        push-after-damage.ts, chase-low-health.ts, overextension.ts
    index.ts      registerAllDetectors()
  index.ts
```

## Registry architecture

Structurally identical in spirit to `player-modeling`'s `DimensionRegistry` (same rationale, same guarantees), operating on detectors instead of analyzers:

| Responsibility | How |
|---|---|
| **Registration** | `register(factory: () => PatternDetector)`. Throws `DuplicateDetectorError` on a repeated `metadata.id`. |
| **Discovery** | `list()` / `get(id)` / `has(id)`. |
| **Dependency ordering** | `executionOrder()` — Kahn's-algorithm topological sort over `metadata.dependsOn`, cached until the next registration change. `UnknownDetectorDependencyError` / `CyclicDetectorDependencyError` on misconfiguration. None of the 18 Phase 6 detectors currently declare a dependency — the mechanism exists for future detectors that need one (e.g. a future "bait susceptibility" detector reading a feint-flagging detector's result). |
| **Versioning** | Each detector declares `metadata.version`, and every `PatternRecord`/`PatternVersion` this phase writes carries it (via the detector's own metadata, resolvable from `detectorId`) — an audit trail for which detector logic produced a value. |
| **Execution** | `execute(ctx, events, logger?)` — runs every registered detector, in dependency order, through its full lifecycle, populating `siblingResults` as it goes. |
| **Failure isolation** | A thrown error from any detector lifecycle method is caught and recorded against that detector only; the run continues. |

**Extending the platform:** implement `PatternDetector` (usually via `BasePatternDetector`) in one new file under `src/detectors/<category>/`, and add one `registry.register(...)` line in `src/detectors/index.ts`. No existing detector, the registry, or the engine ever needs to change.

## Detector interface

```
metadata()      -> static descriptor, readable any time
initialize(ctx) -> reset internal accumulator, capture the run context
consumeEvent()  -> once per raw event in the match's event log
consumeMatch()  -> once, after every event, with match-level context (recentDecisions, statistics, full recentEvents for look-ahead)
detect()        -> pure: derive this match's (opportunities, matches) deltas per patternKey
confidence()    -> pure: how much evidence THIS MATCH contributed overall (a per-match gate, mirroring player-modeling's matchConfidence)
reset()         -> clear the accumulator so the SAME instance can be reused
```

`BasePatternDetector` implements the shared plumbing (context capture, the tally accumulator, the match-evidence confidence gate) so each detector file implements only its own signal, via one of two helpers:

- **`observeBinary(patternKey, matched, description)`** — for a FIXED-HYPOTHESIS habit ("reloads after exactly 2 shots"): every qualifying event is one opportunity, `matched` records whether this instance held.
- **`observeCategorical(counts, describe)`** — for a COMPETING-CATEGORICAL habit (preferred dodge direction — no single privileged hypothesis): every category shares the same opportunity pool (this match's total), so each key's share reflects "this category vs. every other categorical choice this match" — the same share-based shape as `player-modeling`'s categorical dimensions.

**Cross-match contradiction detection for categorical patterns.** A category that used to dominate but stops appearing at all should be *contradicted*, not simply forgotten. `observeCategorical` reads `ctx.priorPatterns` for every patternKey this detector has previously produced for this player+game and includes any that got **zero votes this match** at `count: 0` — so a formerly-dominant category's running evidence correctly sees `matches < opportunities` (a genuine contradiction, triggering the asymmetric-decay path in confidence.ts) instead of silently going dormant. Without this, a categorical pattern could only ever decay through the slow, time-based dormancy sweep, never through an actual behavior change within the same volume of play — see `detector.ts`'s `priorCategoricalKeys()`.

## Implemented pattern detectors

| Category | Detector | Kind | Signal |
|---|---|---|---|
| Movement | Dodge Direction | categorical | `PlayerMoved` (`action:'dodge'`, `direction`) |
| Movement | Escape Routes | categorical | `PlayerMoved` (`context:'escape'`, `routeId`) |
| Movement | Corner Preference | categorical | `PlayerMoved` (`nearCorner:true`, `cornerId`) |
| Movement | Circle Strafing | binary | `PlayerMoved` (`inCombat:true` → `strafing:true`) |
| Combat | Reload Timing | categorical | `AbilityUsed` (`weaponAction:'shoot'`/`'reload'`), bucketed by shots-since-reload |
| Combat | Target Prioritization | categorical | `TargetAcquired` (`targetType`) |
| Combat | Preferred Engagement Distance | categorical | `PlayerDamaged` (`distance`), bucketed close/mid/long |
| Combat | Weapon Preference | categorical | `WeaponEquipped` (`weaponId`) |
| Decision | Retreat Conditions | categorical | `recentDecisions` (`chosenAction:'retreat'`, `context.healthPercent`), bucketed |
| Decision | Healing Timing | categorical | `AbilityUsed` (`abilityType:'heal'`, `healthPercent`), bucketed |
| Decision | Ability Usage Timing | binary | `AbilityUsed` (`timeSinceCooldownReadyMs` ≤ window → "immediate") |
| Decision | Resource Conservation | binary | `AbilityUsed` (`resourceCostRatio` ≤ threshold → "conserving") |
| Exploration | Route Preference | categorical | `PlayerMoved` (`context:'exploration'`, `routeId`) |
| Exploration | Room Clearing Behavior | binary | any event (`roomFullyCleared:true/false`) |
| Exploration | Exploration Order | categorical, 1 vote/match | first event carrying `areaId` this match |
| Risk | Push After Damage | binary | `PlayerDamaged` → aggressive follow-up within N events |
| Risk | Chase Low-Health Enemies | binary | `TargetAcquired` (`targetHealthPercent` ≤ threshold) |
| Risk | Overextension | binary | `PlayerMoved` (`isolationLevel` ≥ threshold) |

Every payload field above is a **documented convention**, not part of the canonical event schema itself (`@adaptive-ai/sdk-protocol`'s `CanonicalEventType` only fixes the event *type* vocabulary — `MatchStarted`, `PlayerMoved`, `AbilityUsed`, etc. — payload shape is genre-specific by design). A plugin that doesn't populate a given field simply never triggers that detector — no detector ever defaults a missing field to a value.

This is the **initial detector set only** — the architecture (registry + `BasePatternDetector`) is built to support many more (whitepaper §5's own examples: bait susceptibility, which additionally needs explicit plugin cooperation to flag a `DecisionPoint` as a deliberate feint).

## Pattern lifecycle

```
Unknown -> Candidate -> Confirmed -> Strong -> Weakening -> Retired
```

- **Unknown** is not a stored state — it's the absence of a `PatternRecord` entirely.
- **Candidate**: a record exists but hasn't cleared the `confirmedConfidence` threshold yet. This is where the whitepaper §5.2 promotion gate (minimum sample count AND statistical concentration) actually lives — not as a separate check, but as an emergent property of `confidence.ts`'s formula: confidence can't clear the threshold without both enough volume *and* real concentration.
- **Confirmed** / **Strong**: confidence at/above `confirmedConfidence` / `strongConfidence`.
- **Weakening**: a pattern that has *previously* reached Confirmed/Strong/Weakening, whose confidence has since fallen back into the middle band — a real habit that's fading, distinct from a still-unproven Candidate at the same confidence level.
- **Retired**: confidence below `retiredConfidence`. **Never deleted** — the record and its full version history remain queryable; only `state` changes, and recovery is allowed (a Weakening or even Retired pattern can climb back to Confirmed/Strong if the evidence supports it again).

Every transition is configurable per detector via `PatternRecognitionConfig.detectorTuning[id].lifecycle` (`confirmedConfidence`, `strongConfidence`, `retiredConfidence`).

## Confidence model

Every `PatternRecord` carries: `observationCount`, `supportingEvidence` (the two raw counts — supporting evidence), `confidence`, `lastObservedAt`, `decayRatePerDay`, `promotionThreshold`, `retirementThreshold` — all of this phase's required fields.

Two mechanisms, layered:

**1. Volume × Concentration** (`applyPatternObservation`, growth path):
```
concentration       = supportingEvidence / observationCount
volumeConfidence     = asymptoticConfidence(observationCount, k)      // reused verbatim from @adaptive-ai/memory-engine
concentrationScore   = clamp((concentration - concentrationBaseline) / (1 - concentrationBaseline), 0, 1)
confidence           = volumeConfidence * concentrationScore
```
Both factors must be nonzero for confidence to grow — enough raw volume (`asymptoticConfidence`, exactly the same asymptotic curve as continuous dimensions, never reinvented) **and** a share meaningfully above a uniform-random baseline (`concentrationBaseline`, tuned per detector — e.g. `1/3` for a three-way categorical choice, `0.5` for a binary one). This is *why* patterns never become "certain" after only a few observations even if every one of them was consistent — `asymptoticConfidence`'s own asymptotic shape guarantees that.

**2. Asymmetric contradiction decay** (whitepaper §5.2's central requirement): a batch containing at least one contradicting observation (`matches < opportunities`) caps confidence at `min(formulaConfidence, priorConfidence * (1 - contradictionDecayRate))` — strictly faster than the formula's own growth would otherwise allow. This penalty only applies once a pattern has *some* prior evidence (`prior.observationCount > 0`) — a brand-new pattern's first-ever batch has no established trust to punish, so it's judged purely on that batch's own volume+concentration merit.

**3. Time-based dormancy decay** (`decayDormantConfidence`, whitepaper §10's daily-cadence sweep): reuses Memory Engine's `decayConfidence` verbatim, applied by `PatternStore.decayDormantPatterns` — a separate, scheduled maintenance operation (not run per-match) that fades confidence for patterns simply not observed in a while, independent of any contradiction.

## Performance

- **Per-match cost:** `O(events + decisions)` per detector, times the number of registered detectors — one linear pass over the match's already-bounded event/decision log. `PushAfterDamageDetector`'s look-ahead is bounded (`pushAfterDamageWindowEvents`, a small constant), never a full re-scan.
- **No historical recomputation:** every detector's per-match output is a *batch delta* folded into the persisted running `(observationCount, supportingEvidence)` — never a recompute from the player's full match history. `PatternStore.upsert` reads exactly one current document, computes the new state, and writes exactly one new version — `O(1)` per pattern per match.
- **Categorical cross-match contradiction detection** (`priorCategoricalKeys`) reads the ALREADY-fetched `ctx.priorPatterns` map (fetched once per run, not per detector) — no extra query.
- **Streaming replay:** a match's event list is walked once, in order, per detector — "replay" here means exactly that single linear pass, never live event handling (this engine only runs after `MatchEnded`, against an already-committed `MatchMemoryRecord`).
- **Batch execution / millions of matches:** detector instances are created fresh per run (`factory()`) and hold no cross-match state of their own; nothing in this package retains in-process state between `processMatch` calls beyond what one call needs.
- **Future parallel detectors:** the same isolation property that makes failure isolation possible (no shared mutable state between detector instances within a run) is what would let independent detectors execute concurrently in a future revision — Phase 6 itself runs them sequentially, in topological order.

## Public API

```ts
import { MemoryEngine } from '@adaptive-ai/memory-engine';
import { PatternRegistry, PatternStore, PatternRecognitionEngine, registerAllDetectors, loadPatternRecognitionConfig } from '@adaptive-ai/pattern-recognition';

const registry = new PatternRegistry();
registerAllDetectors(registry);

const patternStore = new PatternStore(db); // same `Db` instance the app already passes to MemoryEngine
const engine = new PatternRecognitionEngine({
  memoryEngine,   // an already-initialized MemoryEngine
  patternStore,
  registry,
  config: loadPatternRecognitionConfig(),
});
await engine.initialize();

// Call once per match, after MemoryEngine.commitMatch() AND (optionally) player-modeling's processMatch():
const match = await memoryEngine.commitMatch(matchId);
const playerModelingResult = await playerModelingEngine.processMatch(match);
const result = await engine.processMatch(match, playerModelingResult);

// result: { updated, promotions, demotions, skipped, errors, ranAt, playerId, gameId, matchId }

// Search API:
const strongCombatHabits = await patternStore.search({ playerId, gameId, category: 'combat', state: 'strong', sortBy: 'confidence' });

// Daily-maintenance-cadence dormancy sweep (not per-match):
await engine.decayDormantPatterns();
```

## Extension guide

1. Create `src/detectors/<category>/your-pattern.ts`, extending `BasePatternDetector`.
2. Define `metadata` — a stable `id`, `category`, `version` starting at 1, `dependsOn` only if genuinely needed.
3. Implement `consumeEvent`/`consumeMatch`, calling `observeBinary` (fixed hypothesis) or `observeCategorical` (competing categories) to record this match's evidence.
4. Add tuning to `config.ts`'s `detectorTuning` map (`k`, `concentrationBaseline` — pick this relative to how many categories realistically compete, e.g. `1/3` for a three-way choice).
5. Register it in `src/detectors/index.ts`'s `registerAllDetectors()`.
6. Write tests: at minimum a unit case and a boundary/no-evidence case (see any `src/__tests__/detectors/*.test.ts`); lifecycle/confidence-dynamics coverage is centralized in `confidence.test.ts`/`lifecycle.test.ts`/the engine integration tests rather than re-tested per detector — see "Test coverage" below.

## Test coverage

101 tests across 11 files:

- **`confidence.test.ts`** — the shared math, tested ONCE thoroughly: gradual growth, never-certain-from-few-observations, concentration sensitivity, the asymmetric contradiction penalty (including the "brand-new pattern" edge case), dormancy decay, and randomized-input invariants.
- **`lifecycle.test.ts`** — every state transition, boundary-inclusive thresholds, and bidirectional recovery.
- **`detector-base.test.ts`** — `observeBinary`/`observeCategorical`/`detect`/`confidence`/`reset` against synthetic test detectors.
- **`registry.test.ts`** — registration, duplicate rejection, execution order, cycle/missing-dependency detection, failure isolation, detector integration.
- **`pattern-store.test.ts`** — versioning (never overwritten), the search API across every required facet (player/game/detector/category/state/confidence/recent-activity/time-range), and the dormancy sweep.
- **`pattern-recognition-engine.test.ts`** — end-to-end integration: rejecting uncommitted matches, committing qualifying deltas, a full historical-progression promotion (candidate→confirmed→strong across 40 matches), a full retirement path (a habit contradicted for 30 matches fades to weakening/retired), promotion/demotion reporting, the search API used end-to-end, and a randomized-gameplay stress run asserting confidences always stay in `[0, 1]` and no detector ever throws.
- **`detectors/{movement,combat,decision,exploration,risk}.test.ts`** — one unit + one boundary test per detector (18 detectors), since each detector's OWN logic (which raw fields it reads, how it buckets/tallies them) is what's genuinely detector-specific; the confidence/lifecycle *dynamics* every detector shares are already covered exhaustively above and would be pure duplication to re-test per detector.

This is a deliberate testing strategy, not a coverage shortcut: shared math gets deep, once-only tests; per-detector logic gets targeted, detector-specific tests; the full pipeline gets end-to-end tests that exercise real detectors under realistic multi-match sequences (which is where promotion/retirement/historical-progression/randomized-gameplay requirements are actually meaningfully exercised, since those are properties of *sequences of matches*, not of any single detector call).

## Known limitations

- **Exploration Order's single-vote-per-match shape** can't demonstrate genuine cross-category concentration from within-match data alone (every match trivially has `matches === opportunities` for whichever area won that match's one vote) — its confidence growth is driven mostly by volume, not concentration, until a future enhancement computes concentration as a cross-sibling read at query time. Flagged directly in the detector's own file.
- **`PatternStore` has no optimistic-concurrency retry** (unlike Memory Engine's `SemanticMemoryStore`) — it does a straightforward read-compute-write. This is safe under the expected access pattern (one `MatchEnded` → one serialized `processMatch()` call), but would need a compare-and-swap retry loop added if this package's caller ever runs concurrent `processMatch` calls for the *same* player+game.
- **`dependsOn` is unused by all 18 Phase 6 detectors.** The registry's dependency-ordering machinery is fully implemented and tested (see `registry.test.ts`), but no detector in this initial set actually needs cross-detector input — it's infrastructure for a genuinely dependent future detector (e.g. bait susceptibility reading a feint-flagging detector's result), not dead code removed for tidiness.
- **Bait susceptibility (whitepaper §5.1) is not implemented.** It explicitly requires a plugin to flag a `DecisionPoint` as a deliberate feint in its own payload — "the one pattern type that needs explicit per-plugin event-schema cooperation," per the whitepaper — and is deferred rather than implemented against a guessed payload convention.
- **Payload field conventions are documented, not schema-enforced**, exactly as in `player-modeling`'s equivalent limitation — the canonical event schema (`@adaptive-ai/sdk-protocol`) fixes event *types* only; payload shape is genre-specific by design, so every detector treats a missing expected field as "no evidence," never a default.
- **`decayDormantPatterns` is a full collection scan** (`{state: {$ne: 'retired'}}`) rather than an indexed staleness cursor — acceptable for a daily-cadence batch job at the collection sizes this phase was built against, but would want a `lastObservedAt`-indexed cursor with pagination at very large scale.
