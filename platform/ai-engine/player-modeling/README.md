# @adaptive-ai/player-modeling

Turns match history into an evolving behavioral model of every player. Answers exactly one question:

> **"What kind of player is this?"**

It never answers **"what should the AI do?"** — that boundary belongs to `strategy-planner` / `decision-engine`. Player Modeling produces facts about a player; it makes no decisions.

Reference: `ADAPTIVE_AI_ENGINE_WHITEPAPER.md` §3 (Player Modeling Framework) — this package is a direct implementation of that section, using the exact EWMA/asymptotic-confidence math already implemented (not reinvented) in `@adaptive-ai/memory-engine`.

## Status

**Phase 5 — implemented.** The Memory Engine (Phase 4) is complete and approved; from this point on it is the *only* persistence layer for player knowledge. This package writes to it exclusively through its public API (`updateSemanticMemory`, `storeEpisode`) and never touches a database directly.

## Boundary — inputs and outputs

**Inputs (only):**
- Event Pipeline data, via a match's `MatchMemoryRecord.recentEvents` (raw canonical events, bounded)
- `MatchMemoryRecord.recentDecisions` (curated per-decision context — Working Memory's contribution *after* match completion, i.e. Short-Term Memory)
- Prior Semantic Memory (`MemoryEngine.getSemanticProfile`)
- Bounded Semantic Memory *history* (`MemoryEngine.getSemanticHistory`), only for analyzers that declare `historyDependsOn`
- Episodic Memory is written to, never read from, by this phase

**Outputs (only):**
- Updated semantic dimensions (committed through `MemoryEngine.updateSemanticMemory`)
- Confidence values (Memory Engine's persisted confidence, plus this package's own per-match evidence gate — see "Two confidences" below)
- Modeling metadata (`DimensionAnalyzerResult.metadata`, `PlayerModelingRunResult`)
- Episode candidates (`MemoryEngine.storeEpisode`, gated by importance)

**A deliberate scope note:** this package's original design (see git history) anticipated consuming pre-extracted signals from `@adaptive-ai/behavior-analysis`. That package has not been implemented yet (Phase 5's instructions are explicit: inputs are Event Pipeline / Match Summaries / Memory Engine only). Player Modeling therefore derives its own behavioral signals directly from canonical events and decisions in this phase. If/when `behavior-analysis` ships, individual analyzers can be simplified to consume its output instead — that is an internal implementation change, not a boundary change, since the *inputs allowed* (event/match/memory data) don't change.

## Architecture

```
PlayerModelingEngine
      |
      v
DimensionRegistry
      |
      v
Dimension Analyzer  (x13, one per behavioral dimension, isolated)
      |
      v
Memory Engine  (the only persistence layer)
```

- **PlayerModelingEngine** (`player-modeling-engine.ts`) — the orchestrator. Runs the MatchEnded workflow: load prior profile → load match summary → execute analyzers → generate updated dimensions → commit through Memory Engine.
- **DimensionRegistry** (`registry.ts`) — analyzer registration, dependency ordering, versioning, discovery, execution, failure isolation. The only file that knows about more than one analyzer at a time.
- **DimensionAnalyzer** (`analyzer.ts`) — the standard interface every behavioral dimension implements, in complete isolation from every other analyzer.

## Registry design

`DimensionRegistry` is deliberately dumb about *what* a dimension measures — it only knows the standard interface and a metadata descriptor.

| Responsibility | How |
|---|---|
| **Registration** | `register(factory: () => DimensionAnalyzer)`. Throws `DuplicateAnalyzerError` on a repeated `metadata.id`. |
| **Discovery** | `list()` / `get(id)` / `has(id)` over registered `DimensionAnalyzerMetadata`. |
| **Dependency ordering** | `executionOrder()` — Kahn's-algorithm topological sort over `metadata.dependsOn`. Deterministic (insertion order is the tiebreak among analyzers with no relative constraint), cached until the next `register()`/`unregister()`. Throws `UnknownDependencyError` for a `dependsOn` naming an unregistered id, `CyclicDependencyError` for a circular chain. |
| **Versioning** | Each analyzer declares `metadata.version`, recorded on every Memory Engine write as `reason: "player-modeling:v${version}"` — an audit trail for "which analyzer logic produced this value," not a currently-enforced migration mechanism (see "Known limitations"). |
| **Execution** | `execute(ctx, events, logger?)` — runs every registered analyzer, in dependency order, through its full lifecycle. Each analyzer's `siblingResults` entry is populated immediately after it runs, so a dependent always sees its dependency's *this-run* result. |
| **Failure isolation** | A thrown error from any analyzer lifecycle method is caught, recorded against that analyzer only (`AnalyzerExecutionOutcome.error`), and the run continues — one broken analyzer never blocks another's write. |

**Extending the platform** (e.g. adding Curiosity, Adaptability, Creativity, Leadership, Patience, Communication — whitepaper's named future dimensions): implement `DimensionAnalyzer` (usually by extending `BaseDimensionAnalyzer` or `BaseCategoricalAnalyzer`) in one new file under `src/analyzers/`, and add one `registry.register(() => new YourAnalyzer())` line in `src/analyzers/index.ts`. No existing analyzer file, registry code, or engine code changes.

## Analyzer lifecycle

Every analyzer implements this interface (`analyzer.ts`), called in this exact order, once per (player, match) run:

```
metadata()      -> static descriptor, readable any time
initialize(ctx) -> reset internal accumulator, capture the run context
consumeEvent()  -> once per raw event in the match's event log
consumeMatch()  -> once, after every event, with match-level context (recentDecisions, statistics, ...)
calculate()     -> pure: derive this match's observation(s) from the accumulator
confidence()    -> pure: how much to trust calculate()'s result (the per-match evidence gate)
update()        -> pure: fold ONE observation into a prior (value, confidence, samples) via the shared EWMA primitive
reset()         -> clear the accumulator so the SAME instance can be reused for the next run
```

`BaseDimensionAnalyzer` and `BaseCategoricalAnalyzer` implement the plumbing shared by every dimension of their kind (context capture, the `update()` → `applyObservation()` delegation, memoized `confidence()`) so each dimension file only implements its own behavioral signal: `consumeEvent`/`consumeMatch`/`deriveResult`/`resetAccumulator`. This is shared **base-class plumbing**, not a shared **PlayerModel god-object** — each analyzer instance still owns only its own accumulator, registers independently, and can be added/removed without touching any other analyzer. The whitepaper's "no giant PlayerModel class" requirement is about state and responsibility isolation, not a ban on DRY boilerplate.

### Two confidences — read this before touching thresholds

There are two, deliberately distinct, confidence concepts in this package:

1. **`matchConfidence`** (`DimensionAnalyzerResult.matchConfidence`, and `analyzer.confidence()`) — **this match's evidence gate**: how much to trust the observation *this specific match* produced, based on how much qualifying evidence was seen (sample count this match, and for categorical dimensions, how peaked the distribution was). Configured per dimension via `PlayerModelingConfig.dimensionTuning[id].minMatchConfidence` — below the gate, the observation is **not submitted at all** this match (recorded as `skipped`, never fabricated).
2. **The persisted dimension confidence** (`SemanticDimensionState.confidence`, Memory Engine's own) — the **cross-match, asymptotic** confidence from `1 - e^(-samples/k)`, tracking how much history now backs the whole profile.

An analyzer can be very confident in a well-measured match (`matchConfidence` high) while the *persisted* dimension is still new and low-confidence (few matches so far) — these two numbers answer different questions and are never conflated.

### Categorical dimensions

Whitepaper §3.3: favorites use the identical EWMA machinery as continuous dimensions, over a frequency table rather than a scalar. `BaseCategoricalAnalyzer` implements this by persisting **each category as its own scalar Memory Engine dimension** — `${metadata.id}:${category}` — observed as that category's *share* of this match's qualifying events. The "favorite" is `argmax` over the resulting per-key EWMA values at read time, exactly as the whitepaper specifies, with no change to Memory Engine's scalar-only `updateSemanticMemory` API.

### `dependsOn` vs. `historyDependsOn`

- **`dependsOn`** — other dimension ids whose **this-run** result this analyzer reads via `ctx.siblingResults` (populated in dependency order by the registry). Only `confidence` (`player-confidence.ts`) declares this in Phase 5, reading `decisionSpeed`/`riskTolerance`'s `matchConfidence` to cap its own — a composite signal can never be more trustworthy than its inputs.
- **`historyDependsOn`** — dimension ids whose **persisted history** (not this match's result) this analyzer needs. Only `learningRate` declares this, reading a bounded window (`PlayerModelingConfig.historyLookbackVersions`, default 5) of `mechanicalSkill`/`strategicSkill` versions, prefetched once by `PlayerModelingEngine` before running the registry — never a full-history scan.

## Mathematical model

Exactly the model already defined and implemented in `@adaptive-ai/memory-engine` (whitepaper §3.1/§12.2) — **reused via `applyObservation`/`asymptoticConfidence`, never reimplemented**:

```
value_new  = value_old + α · (observation − value_old)     // EWMA
confidence = 1 − e^(−samples / k)                            // asymptotic, never reaches 1
α          = 1 / (1 + samples)   [bounded below by α_min]     // fast early learning,
                                                                // slows as evidence accumulates
```

`k` is tuned per dimension (`PlayerModelingConfig.dimensionTuning`), not global — matching every dimension's own whitepaper §3.2 guidance (stable traits like `reactionTime` use a larger `k`; context-sensitive ones use a smaller one). `analyzer.update()` is a **pure preview** computed locally against the prior snapshot fetched before the match ran; the value **actually persisted** comes from `MemoryEngine.updateSemanticMemory`'s own authoritative, concurrency-safe (compare-and-swap) recomputation from live DB state at write time — the preview is used only for episode-candidate delta scoring, never written anywhere itself.

`asymptoticConfidence` is also reused directly wherever this package computes a **per-match** evidence gate (a different application of the same "more samples → more trust, asymptotically" primitive, at a per-match rather than per-profile-lifetime timescale).

## Dimension definitions (whitepaper §3.2)

| Dimension | Kind | Signal source | Notes |
|---|---|---|---|
| **Reaction Time** | continuous | `recentDecisions[].context.reactionMs`, or `ts - context.stimulusTs` | Raw ms, per-game. Cross-game normalized/percentile form is future cross-game-rollup work, not this package's job. |
| **Decision Speed** | continuous | `context.decisionLatencyMs`, or `ts - context.offeredAt` | "Which option, how fast" — distinct from Reaction Time's raw motor-response latency. |
| **Aggression** | continuous | `AbilityUsed` (offensive unless `payload.offensive===false`) + `TargetAcquired`, over total action events | |
| **Risk Tolerance** | continuous | `context.riskLevel` (Influence-Map-style [0,1]) ≥ `PlayerModelingConfig.highRiskThreshold` | Decisions without a `riskLevel` contribute no evidence — never defaulted. |
| **Consistency** | continuous | Inverse of this match's decision-latency variance | Self-contained — recomputes latency, doesn't read Decision Speed's result, to stay isolated. |
| **Predictability** | continuous | `1 - normalizedEntropy(chosenAction distribution)` | **Provisional** — whitepaper says this should be the complement of Pattern Recognition's own entropy measure, "not independently computed." Pattern Recognition doesn't exist yet; see "Known limitations." |
| **Learning Rate** | continuous | Average slope of `mechanicalSkill`/`strategicSkill`'s recent persisted history | The only dimension reading history instead of this match's events. |
| **Mechanical Skill** | continuous | `AbilityUsed` hit rate, penalized by `AbilityOnCooldownAttempt` | Coarse/generalized execution quality. |
| **Strategic Skill** | continuous | `context.favorableOutcome` per decision, falling back to `match.statistics.outcome` | Whitepaper's own "hardest to generalize" caveat — the fallback is capped at low confidence, never conflated with real per-decision evidence. |
| **Exploration** | continuous | Distinct `ItemPicked`/`WeaponEquipped`/`TargetAcquired` entities / total touches, **this match only** | Per-match diversity proxy, not cross-match novelty tracking (would violate the no-historical-recomputation requirement). |
| **Preferred Combat Distance** | categorical | `PlayerDamaged`/`PlayerMoved` `payload.distance`, bucketed via `combatDistanceBuckets` | Genre-relative world units; only meaningful for plugins that declare a distance axis. |
| **Preferred Strategies** | categorical | `context.strategyTag`, falling back to `chosenAction` | |
| **Confidence** (player's) | continuous, composite | Within-match trend of decision-latency (falling ⇒ more confident) + risk-taking (rising ⇒ more confident) | The only dimension using `dependsOn`; gated by `decisionSpeed`/`riskTolerance`'s own `matchConfidence`. |

## Performance characteristics

- **Per-match cost:** `O(events + decisions)` per analyzer, times the number of registered analyzers — every analyzer does exactly one linear pass over the match's bounded event/decision log (Memory Engine already bounds these — see its `ShortTermMemoryConfig`). No analyzer performs a full-history scan.
- **`learningRate`'s history read:** `O(historyLookbackVersions)` per dependency dimension (default 5), fetched once per match via `MemoryEngine.getSemanticHistory`'s own indexed, limited query — never `O(total matches ever played)`.
- **Persistence:** every write goes through `MemoryEngine.updateSemanticMemory`, which is itself `O(1)` per dimension per match (EWMA, never a recompute-from-full-history operation — see memory-engine's own README).
- **Millions of players:** analyzer instances are created fresh per run by the registry (`factory()`) and hold no cross-player state; nothing in this package retains any in-process state between `processMatch` calls beyond what a single call needs. This is what makes the design horizontally scalable — any number of matches, for any number of players, can be processed by any number of worker processes with zero shared mutable state between them.
- **Future parallel execution:** `DimensionRegistry.execute()`'s per-analyzer isolation (no shared mutable state between analyzer instances in a single run, dependencies resolved via an explicit ordering) is what would let independent analyzers within one run execute concurrently in a future revision — not implemented in Phase 5 (execution is currently sequential, in topological order), but the isolation the whitepaper requires is what makes that upgrade purely additive later.

## Public API

```ts
import { MemoryEngine } from '@adaptive-ai/memory-engine';
import { DimensionRegistry, registerAllAnalyzers, PlayerModelingEngine, loadPlayerModelingConfig } from '@adaptive-ai/player-modeling';

const registry = new DimensionRegistry();
registerAllAnalyzers(registry);

const engine = new PlayerModelingEngine({
  memoryEngine, // an already-initialized @adaptive-ai/memory-engine MemoryEngine
  registry,
  config: loadPlayerModelingConfig(),
});

// Call once per match, ONLY after MemoryEngine.commitMatch() has produced the record:
const record = await memoryEngine.commitMatch(matchId);
const result = await engine.processMatch(record);

// result: { updated, skipped, errors, episodeCandidates, ranAt, playerId, gameId, matchId }
```

Also exported: every individual `*Analyzer` class (for direct unit testing or standalone use), `BaseDimensionAnalyzer`/`BaseCategoricalAnalyzer` (for writing new analyzers), the full `types.ts` surface, and `stats.ts`'s small numeric helpers (`mean`, `variance`, `entropy`, `normalizedEntropy`, `clamp`).

## Extension guide

To add a new behavioral dimension (e.g. one of the whitepaper's named future dimensions — Curiosity, Adaptability, Creativity, Leadership, Patience, Communication):

1. Create `src/analyzers/your-dimension.ts`, extending `BaseDimensionAnalyzer` (scalar) or `BaseCategoricalAnalyzer` (frequency table).
2. Define `metadata` — pick a stable `id` (never renamed once shipped; see "Known limitations"), a `version` starting at 1, `kind`, `scope`, and `dependsOn`/`historyDependsOn` only if genuinely needed.
3. Implement `consumeEvent`/`consumeMatch` to accumulate whatever raw signal your dimension needs, and `deriveResult()` (or `tally()` calls, for categorical) to turn the accumulator into this match's observation(s).
4. Add tuning to `config.ts`'s `dimensionTuning` map (a sensible `k` and `minMatchConfidence`) — never hardcode these in the analyzer file.
5. Register it in `src/analyzers/index.ts`'s `registerAllAnalyzers()`.
6. Write tests covering: a basic unit case, a boundary/insufficient-evidence case, and (if the dimension takes a sample count) a confidence-evolution case — following the pattern in any existing `src/__tests__/<dimension>.test.ts`.

No existing analyzer, the registry, or the engine ever needs to change for this.

## Known limitations

- **Predictability is provisional.** It computes its own chosen-action entropy rather than reading Pattern Recognition's (whitepaper §5) — because that module doesn't exist yet. Once it does, whitepaper §3.2 is explicit these are "two views of one underlying signal, not independently computed," and this analyzer should be simplified to read it.
- **Exploration is a per-match diversity proxy, not cross-match novelty detection.** True "has this player never done this before, ever" tracking would require either an unbounded per-player state scan (violates the constant-time-update requirement) or a dedicated bounded novel-state index — flagged as future work, not attempted here.
- **Strategic Skill's match-outcome fallback is coarse.** Whitepaper §3.2 itself calls this "the hardest dimension to generalize well," needing a genuine per-plugin Decision Adapter. The fallback (single match-level outcome, confidence capped low) is honest about being a stopgap, not a solution.
- **Episode-candidate generation is a simple magnitude heuristic** (`|Δvalue| ≥ episodeCandidateMinDelta`), not real salience scoring. Whitepaper §5's richer significance testing (concentration vs. a uniform-random null hypothesis, per-plugin feint-flagging cooperation, etc.) belongs to Pattern Recognition, a future phase — this package only ever proposes *candidates* as modeling metadata, consistent with never answering "what should the AI do."
- **Analyzer `version` is recorded, not enforced.** A version bump is written into every update's `reason` field for audit purposes, but nothing in this phase automatically detects "this persisted history was produced by an older analyzer version and may need reconciliation" — a future migration tool would need to scan `playerProfileVersions` by `reason` if that ever becomes necessary.
- **Sequential, not parallel, analyzer execution.** The isolation the whitepaper requires ("every analyzer remains isolated from every other") is fully in place, which is what would make a future move to concurrent execution-within-a-run purely additive — but Phase 5 itself runs analyzers sequentially in topological order.
- **Float-precision ceiling on confidence**, inherited directly from `@adaptive-ai/memory-engine`'s `asymptoticConfidence` — see that package's README for the documented IEEE-754 detail.
