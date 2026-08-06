# @adaptive-ai/explainability

Converts the Decision Engine's and Strategy Planner's already-stored reasoning traces into deterministic, evidence-backed, awareness-budget-truthful explanations. **No generative AI anywhere in this pipeline** — every explanation is a template-filled readout of real trace data.

## Responsibility

**Hard constraint (whitepaper §8):** explanations must be a deterministic *readout* of the actual decision trace, never a separate post-hoc "explain yourself" generative step. Post-hoc generation risks *confabulation* — a plausible-sounding explanation that isn't causally connected to what actually happened — which would be an existential credibility risk for a platform whose entire differentiator is "prove to the player this is real, not scripted."

This is tractable specifically because `@adaptive-ai/decision-engine` uses Utility AI: every decision is already a decomposable weighted sum of named considerations. An explanation is a templated readout of "which consideration(s) dominated," filled with the real numbers and the real `Pattern`/`SemanticProfile`/`PlayerEpisode` entries that fed them — never invented, never guessed.

**This subsystem never influences gameplay.** It only reads out decisions that have already been made, by `decision-engine` and `strategy-planner`, through their existing public output types. It never mutates a `Decision` or `StrategicIntent`, never calls back into either engine, and has no code path that could feed back into action selection.

## Status

**Implemented (Phase 9).** The final reasoning subsystem before game integration — TOSIOS integration begins after this phase.

## 1. Directory tree

```
explainability/
├── src/
│   ├── types.ts                    Every explanation type's structured shape (the JSON schema, in TS form)
│   ├── config.ts                   Confidence bucket thresholds, dimension polarity map, trend epsilon, key-moment count
│   ├── errors.ts                   Typed error hierarchy (one class per failure mode)
│   ├── logger.ts                   Structured logging (same convention as every other AI-engine package)
│   ├── confidence.ts               confidenceReading() — buckets a REAL numeric confidence into low/medium/high
│   ├── evidence.ts                 EvidenceRef / TraceabilityBuilder — shared by every explainer
│   ├── templates.ts                Pure natural-language template-fill functions — the ONLY place strings are built
│   │
│   ├── decision-explainer.ts       explainDecision()        — the core: Decision + StrategicIntent -> DecisionExplanation
│   ├── strategy-explainer.ts       explainStrategy()        — StrategicIntent -> StrategyExplanation
│   ├── pattern-explainer.ts        explainPattern()         — one PatternEntry -> PatternExplanation
│   ├── profile-explainer.ts        explainPlayerProfile()   — SemanticProfileEntry[] -> PlayerProfileExplanation
│   ├── episode-explainer.ts        explainEpisode()         — one PlayerEpisode -> EpisodeExplanation
│   ├── match-summary.ts            summarizeMatch()         — DecisionExplanation[] -> MatchSummary
│   ├── behavior-evolution.ts       computeBehaviorEvolution() — SemanticDimensionVersion[] history -> BehaviorEvolution
│   ├── confidence-evolution.ts     computeConfidenceEvolution() — confidence-over-time -> ConfidenceEvolution
│   ├── match-comparison.ts         compareMatches()         — two MatchSummaries -> MatchComparison
│   ├── player-insights.ts          generatePlayerInsights() — profile + patterns + evolutions -> PlayerInsights
│   │
│   ├── explanation-store.ts        ExplanationStore — Mongo persistence, collection `explanations`
│   ├── explainability-engine.ts    ExplainabilityEngine — pure explainer + store, the public orchestrator
│   ├── router.ts                   Express read-API (createExplainabilityRouter)
│   ├── index.ts                    Public exports
│   │
│   └── __tests__/
│       ├── fixtures.ts                     Builders — including REAL StrategyPlanner+DecisionEngine runs
│       ├── fake-mongo.ts                   In-memory Mongo driver fake
│       ├── decision-explainer.test.ts      Traceability, truthfulness, missing-data, malformed-input, determinism
│       ├── awareness-enforcement.test.ts   Tier-by-tier (beginner/veteran/expert) gating proofs
│       ├── strategy-explainer.test.ts
│       ├── single-entity-explainers.test.ts  Pattern / PlayerProfile / Episode explainers
│       ├── confidence.test.ts
│       ├── match-summary.test.ts
│       ├── evolution.test.ts               Behavior + Confidence Evolution
│       ├── match-comparison.test.ts
│       ├── player-insights.test.ts
│       ├── explanation-store.test.ts
│       ├── explainability-engine.test.ts
│       ├── router.test.ts
│       ├── randomized-and-replay.test.ts   40-iteration randomized truthfulness sweep + replay determinism
│       └── regression.test.ts              Golden fixed-output assertions
│
├── package.json
├── tsconfig.json
└── README.md
```

## 2. Architecture

```
                       ┌─────────────────────────┐
  Decision  ─────────► │                         │
  StrategicIntent ────►│   Pure explainer layer  │────► Structured explanation
  SemanticProfile ────►│  (decision-explainer.ts,│      (DecisionExplanation, ...)
  PatternEntry[] ─────►│   strategy-explainer.ts,│
  PlayerEpisode[] ────►│   pattern-explainer.ts, │
                       │   ...one file per type) │
                       └───────────┬─────────────┘
                                   │ pure function, no I/O
                                   ▼
                       ┌─────────────────────────┐
                       │   templates.ts           │  naturalLanguage: string[]
                       │  (template-fill only)     │  (rendered FROM the struct,
                       └─────────────────────────┘   never the other way around)
                                   │
                                   ▼
                       ┌─────────────────────────┐
                       │  ExplainabilityEngine    │  generate + persist
                       │  (explainability-engine  │  (thin orchestrator, no
                       │   .ts)                   │   generation logic itself)
                       └───────────┬─────────────┘
                                   ▼
                       ┌─────────────────────────┐
                       │   ExplanationStore        │  Mongo collection `explanations`
                       │  (explanation-store.ts)   │  (Timeline / History / Match / Player queries)
                       └───────────┬─────────────┘
                                   ▼
                       ┌─────────────────────────┐
                       │  Express router            │  Decision / Match / Player / Pattern /
                       │  (router.ts)               │  Timeline / Profile-Evolution / History
                       └─────────────────────────┘
```

Every explainer function (`explainDecision`, `explainStrategy`, ...) is **pure**: no I/O, no wall-clock reads (a `now`/timestamp is always an explicit parameter, sourced from the record being explained — e.g. `decision.executionTimestamp`), no randomness except a fresh `explanationId` (same convention as `decision-engine`'s `decisionId`/`strategy-planner`'s `intentId` — an identity, not content). `ExplainabilityEngine` is the only place I/O happens, and it contains no generation logic of its own — every method is `pureExplainer(...) → store.store(...)`.

## 3. Explanation pipeline

For a **Decision Explanation** specifically (`decision-explainer.ts`), the pipeline is:

1. **Validate** — `decision.reasoningTrace.strategicIntentGoalId` must equal `strategicIntent.goalId` (`IntentDecisionMismatchError` otherwise); `decision.score.breakdown` must be non-empty (`MalformedDecisionTraceError` otherwise).
2. **Rank considerations** — every entry in `decision.score.breakdown` (the winning action's own, never-truncated breakdown) gets `contribution = considerationWeight × considerationValue`, using the REAL resolved weights from `decision.reasoningTrace.considerationWeights` (personality already baked in by `decision-engine`). Sorted by contribution descending, ties broken by ascending `considerationId` — deterministic.
3. **Split** — highest contribution becomes `primaryReason`; the rest become `supportingEvidence`, in the same order.
4. **Resolve awareness-gated evidence** — `patternsUsed`/`playerTraitsUsed` are built by iterating `decision.reasoningTrace.awarenessUsed.patternIdsRead` / `.semanticDimensionsRead` (never by scanning the caller's full context for anything merely relevant) and joining each id against the caller-supplied `patterns`/`semanticProfile` arrays. `memoriesReferenced` does the same against `strategicIntent.awarenessUsed.episodeIdsRead` — see §3.1 below for why episodic memory comes from the *Strategy* layer's own record, not the Decision layer's.
5. **Resolve alternatives** — every non-winning entry in `decision.alternatives` (already ranked by `decision-engine`), each annotated with `utilityGapFromWinner`.
6. **Bucket confidence** — `decision.score.confidence` (already a real computed margin, whitepaper's "decisive vs. close call" semantics) is bucketed into low/medium/high via `confidence.ts` — never re-derived, never estimated.
7. **Render** — one `templates.ts` function per sentence, each paired with an `EvidenceRef[]` via `TraceabilityBuilder`, so `traceability[i]` always explains `naturalLanguage[i]`.

### 3.1 Why episodic memory comes from the Strategy layer

`decision-engine`'s `DecisionInputs` does **not** include episodic memory at all (see its own `types.ts` — the Decision Engine's seven legal inputs are `strategicIntent`, `legalActions`, `matchContext`, `publicGameState`, `semanticProfile`, `patterns`, `awarenessBudget`, `personality`). Only `strategy-planner`'s goals read episodic memory, via `PlanningInputs.episodicMemory`. So a *decision*'s episodic grounding is inherited transitively — "I predicted this because of a past encounter" is really "the STRATEGY that led to this decision was informed by a past encounter" — which is exactly why `memoriesReferenced` sources from `strategicIntent.awarenessUsed.episodeIdsRead`, not from anything on `Decision` itself. This is a faithful readout of the real causal chain, not a shortcut.

## 4. JSON schemas

Full TypeScript definitions live in `src/types.ts`; the ten explanation types are:

| Type | Produced by | Key fields |
|---|---|---|
| `DecisionExplanation` | `explainDecision()` | `summary`, `primaryReason`, `supportingEvidence[]`, `alternativesConsidered[]`, `patternsUsed[]`, `playerTraitsUsed[]`, `memoriesReferenced[]`, `confidence`, `awarenessTier`, `traceability`, `naturalLanguage[]` |
| `StrategyExplanation` | `explainStrategy()` | `chosenCandidate`, `rejectedAlternatives[]`, `plannedSequence[]`, `confidence`, `awarenessUsed` |
| `PatternExplanation` | `explainPattern()` | `patternId`, `category`, `description`, `state`, `confidence` |
| `PlayerProfileExplanation` | `explainPlayerProfile()` | `dimensions[]` (each with `value`, `confidence`, `samples`) |
| `EpisodeExplanation` | `explainEpisode()` | `episodeType`, `summary`, `importance`, `confidence`, `timestamp` |
| `MatchSummary` | `summarizeMatch()` | `decisionCount`, `averageUtility`, `averageConfidence`, `goalCategoryBreakdown[]`, `closestCalls[]`, `mostDecisive[]` |
| `BehaviorEvolution` | `computeBehaviorEvolution()` | `firstValue`, `lastValue`, `delta`, `direction` |
| `ConfidenceEvolution` | `computeConfidenceEvolution()` | `firstConfidence`, `lastConfidence`, `direction` |
| `MatchComparison` | `compareMatches()` | `dimensionDeltas[]`, `decisionCountDelta`, `averageUtilityDelta`, `personalityChanged` |
| `PlayerInsights` | `generatePlayerInsights()` | `insights[]` (`category`: strength / weakness / improvingSkill / recurringMistake / emergingHabit / behaviorChange / learningTrend, each with `evidence[]`) |

Every type shares the same closing fields: `explanationId`, `generatedAt`, `traceability: TraceabilityMap`, `naturalLanguage: string[]`, `schemaVersion: 1`.

`TraceabilityMap` is `Array<{ claim: string; evidence: EvidenceRef[] }>` — `EvidenceRef` is `{ kind, id, label, detail }`, where `kind` is one of `consideration | pattern | semanticDimension | episode | goal | alternativeAction | worldFact | planStep`.

## 5. Public API

### Library (`ExplainabilityEngine`)

```ts
import { ExplainabilityEngine, ExplanationStore } from '@adaptive-ai/explainability';

const store = new ExplanationStore(db);
await store.ensureIndexes();
const engine = new ExplainabilityEngine({ store });

const explanation = await engine.explainDecision({ decision, strategicIntent, semanticProfile, patterns, episodes });
const summary = await engine.summarizeMatch(matchId);
const insights = await engine.generatePlayerInsights({ playerId, gameId, profile, patterns, behaviorEvolutions });
```

Every pure explainer (`explainDecision`, `explainStrategy`, `explainPattern`, `explainPlayerProfile`, `explainEpisode`, `summarizeMatch`, `computeBehaviorEvolution`, `computeConfidenceEvolution`, `compareMatches`, `generatePlayerInsights`) is also exported directly for callers that don't need persistence.

### HTTP (`createExplainabilityRouter`)

| Method & path | Maps to mission requirement |
|---|---|
| `GET /explainability/decisions/:decisionId` | Decision Explanation |
| `GET /explainability/matches/:matchId` | (every decision explanation for a match) |
| `GET /explainability/matches/:matchId/summary` | Match Explanation |
| `GET /explainability/players/:playerId/summary?gameId=` | Player Summary |
| `GET /explainability/players/:playerId/patterns/:patternId` | Pattern Explanation |
| `GET /explainability/players/:playerId/timeline?gameId=&fromTs=&toTs=&limit=` | Timeline |
| `GET /explainability/players/:playerId/profile-evolution?gameId=` | Profile Evolution |
| `GET /explainability/players/:playerId/history?matchId=&gameId=&explanationType=&limit=&offset=` | Explanation History |

Same convention as `@adaptive-ai/orchestration`'s `dashboard-router.ts`: thin pass-through, no auth baked in (mounted behind whatever the host app already applies), errors mapped from `ExplainabilityError.code` to an HTTP status (`EXPLANATION_NOT_FOUND` → 404, everything else typed → 400, unknown → 500).

## 6. Test coverage

87 tests across 14 files (`npm test`):

- **Traceability** — every `naturalLanguage[i]` has a corresponding `traceability[i]`; `primaryReason`/`supportingEvidence` together cover every consideration in the breakdown exactly once; claim ordering is fixed.
- **Truthfulness / Awareness Budget enforcement** — `patternsUsed`/`playerTraitsUsed`/`memoriesReferenced` provably equal the real `AwarenessUsed` id lists, never more; beginner tier is proven structurally empty; a candidate-state (not yet trusted) pattern is proven never surfaced even at expert tier; a dedicated `awareness-enforcement.test.ts` walks all three tiers explicitly.
- **Missing reasoning data** — `MissingReasoningDataError` when a recorded-as-read pattern/dimension/episode is absent from the supplied context.
- **Malformed input** — `IntentDecisionMismatchError`, `MalformedDecisionTraceError`, `MalformedPlanningTraceError`, `EmptyDecisionSetError`, `InconsistentMatchDataError`, `InsufficientHistoryError`.
- **Determinism / Replay determinism** — the same inputs replayed any number of times produce byte-identical output apart from the fresh `explanationId`; verified for `DecisionExplanation`, `StrategyExplanation`, and `MatchSummary`.
- **Pattern / memory references** — dedicated assertions that surfaced patterns/episodes match real upstream records field-for-field.
- **Randomized scenarios** — 40 randomized (awareness budget × personality × game state) real `StrategyPlanner` + `DecisionEngine` runs, asserting the truthfulness invariant and structural invariants (confidence in `[0,1]`, traceability/naturalLanguage same length) hold for every one.
- **Regression** — golden fixed-input assertions on exact structured fields and the exact natural-language sentence sequence, so a future template/ranking change must be a deliberate decision.
- **Store / Engine / Router** — round-trip persistence, upsert semantics for deterministic-id aggregate types, pagination, timeline ordering, and the full Express API surface via `supertest`.

Notably, most tests run the **real** `@adaptive-ai/strategy-planner` and `@adaptive-ai/decision-engine` end-to-end (see `fixtures.ts`'s `buildRealStrategicIntent`/`buildRealDecision`) rather than hand-shaped stand-ins — proving this package correctly consumes genuine upstream trace shapes, not just its own assumptions about them.

## 7. Performance benchmarks

Every explainer is a single pass over already-small, already-bounded structures: `decision.score.breakdown` is one entry per registered `Consideration` (6 in the current registry), `decision.alternatives` is one entry per legal action (`O(actions)`, the same bound `decision-engine` itself operates under), and awareness-used id lists are bounded by how many patterns/dimensions a single decision's considerations actually read (small, single digits in practice). There is no search, no recursion, no unbounded loop anywhere in this package — `explainDecision` is `O(considerations + alternatives + patternsRead + traitsRead + memoriesRead)`, all small constants. Persistence (`ExplanationStore`) is a single indexed `replaceOne`/`insertOne` per explanation; query methods (`getForMatch`, `getTimeline`, `search`) are single indexed Mongo queries, not application-level joins.

## 8. Example explanations

Given the default test fixtures (`aggressive` personality, expert awareness tier, a confirmed `pattern-rushes-low-health` pattern, `aggression=0.85`), `explainDecision()` produces:

```json
{
  "summary": { "actionId": "attack", "goalId": "forceReload", "goalDisplayName": "Force Reload", "goalCategory": "tempo", "personality": "aggressive", "utility": 0.6948 },
  "primaryReason": { "considerationId": "punishOpening", "considerationWeight": 1.7, "considerationValue": 0.9, "contribution": 1.53 },
  "patternsUsed": [{ "patternId": "pattern-rushes-low-health", "description": "Rushes enemies at low health", "confidence": { "value": 0.82, "level": "high" }, "state": "confirmed" }],
  "playerTraitsUsed": [{ "dimension": "aggression", "value": 0.85, "confidence": { "value": 0.8, "level": "high" } }],
  "confidence": { "value": 0.1584, "level": "low" },
  "awarenessTier": "expert"
}
```

and the corresponding `naturalLanguage`:

```
Chose action "attack" in pursuit of "Force Reload" (tempo); utility 0.69.
The strongest factor was "punishOpening" (weight 1.70 × value 0.90 = 1.53).
Supporting factors: profileExploit (0.90), patternExploit (0.83), actionFreshness (0.50), planAdherence (0.30), safety (0.50).
2 alternative action(s) were considered; the closest was "wait", 0.19 utility lower.
Drew on 1 known pattern(s): "Rushes enemies at low health" (high confidence (0.82)).
Drew on player traits: aggression=0.85 (high confidence (0.80)).
No specific past encounters were recalled for this decision.
Overall decision confidence: low confidence (0.16).
Awareness tier at decision time: expert.
```

Note the LOW overall confidence despite a clear primary reason — `decision.score.confidence` measures the margin between the winning and runner-up action, not how strong any single consideration was; this is real reasoning confidence, never fabricated certainty (see `regression.test.ts`, which pins this exact output).

## 9. Traceability examples

The whitepaper's worked example — `"I pressured the player because..." → Goal ID → Utility Score → Supporting Pattern IDs → Player Dimensions → Awareness Tier → Decision ID` — is recoverable programmatically from `DecisionExplanation.traceability`:

```json
[
  { "claim": "summary", "evidence": [{ "kind": "goal", "id": "forceReload", "label": "Force Reload", "detail": { "category": "tempo" } }] },
  { "claim": "primaryReason", "evidence": [{ "kind": "consideration", "id": "punishOpening", "detail": { "weight": 1.7, "value": 0.9 } }] },
  { "claim": "patternsUsed", "evidence": [{ "kind": "pattern", "id": "pattern-rushes-low-health", "detail": { "state": "confirmed" } }] },
  { "claim": "playerTraitsUsed", "evidence": [{ "kind": "semanticDimension", "id": "aggression", "detail": { "value": 0.85 } }] },
  { "claim": "awarenessTier", "evidence": [{ "kind": "worldFact", "id": "decision.metadata.awarenessTier", "detail": { "tier": "expert" } }] }
]
```

Every `EvidenceRef.id` is a real id from a real upstream record — `goalId`, `considerationId`, `patternId`, `dimension` name — so a caller (or a future audit tool) can always jump from a sentence, to its claim, to its evidence, to the exact upstream field it came from, and finally to `DecisionExplanation.decisionId` / `StrategicIntent.intentId` to locate the original trace. This mapping is exercised directly by `decision-explainer.test.ts`'s traceability tests and `regression.test.ts`'s fixed claim-order assertion.

## 10. Known limitations

- **`memoriesReferenced` is usually empty in practice.** No `Goal` shipped in the current `strategy-planner` registry actually calls `readEpisodes()` (verified by inspecting `src/goals/*.ts`), so `strategicIntent.awarenessUsed.episodeIdsRead` is empty for every real plan today. The plumbing is fully correct and tested (`decision-explainer.test.ts` exercises the non-empty path with a hand-populated `AwarenessUsed`), but it will only populate for real once a future Goal reads episodic memory.
- **Player Insights classification is opt-in, not universal.** `strength`/`weakness` insights only fire for dimensions listed in `config.dimensionPolarity` (defaults cover the whitepaper §11 cross-game-transferable dimensions); `recurringMistake` only fires for pattern categories listed in `config.mistakePatternCategories` (empty by default). A genre-specific dimension/category a plugin introduces produces NO insight until a caller explicitly extends this config — silence, not a guess, by design.
- **`MatchSummary`/aggregate explanation types use deterministic ids** (e.g. `match-summary:{matchId}`), so re-computing one overwrites the prior stored snapshot rather than accumulating history. This is intentional (a match summary represents "current state of this match"), but means there's no built-in way to see how a `MatchSummary` looked at an earlier point mid-match — only the latest.
- **No natural-language localization.** `templates.ts` produces English sentences only; the structured JSON (which every sentence is generated from) is the localization-ready layer if that's needed later.
- **Router has no authorization check** that the requesting caller IS `playerId` — same documented gap as `orchestration`'s `dashboard-router.ts`, intentionally deferred to whatever auth middleware the host app applies.
- **Not yet wired into a live game loop.** This package has been validated against real `strategy-planner`/`decision-engine` output in tests, but end-to-end integration (an actual match producing real Decisions that flow into this package) happens during TOSIOS integration, the next phase.

## Reference

`ADAPTIVE_AI_ENGINE_WHITEPAPER.md` §8 (Explainability, in full), §6 (Decision-Making Architecture — why Utility AI makes this tractable), §7 (Awareness Budget — the truthfulness contract this package enforces), §9 (Personality — why `considerationWeights` are already resolved before this package ever sees them).
