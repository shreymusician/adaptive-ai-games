# @adaptive-ai/decision-engine

The tick-rate layer of the Decision Architecture, and the **only** AI Engine module permitted to call back through the Plugin SDK boundary.

## Responsibility

Given the plugin's currently-legal actions (`getLegalActions()`) and the active `StrategicIntent` from `strategy-planner`, scores every candidate action via **Utility AI** — a weighted sum of named considerations (current plan alignment, Player Profile dimensions, active Personality weights, immediate tactical state) — and returns the highest-scoring (or, for Experimental personality, occasionally a seeded-random lower-ranked) choice as a `Decision`, submitted through the SDK's `submitDecision` channel, the identical path human input travels through.

This is the direct analog of Alien: Isolation's "Xenomorph" executor: genuinely constrained to only what the plugin's declared interface exposes, never given anything beyond intent from the layer above it.

Utility AI was chosen deliberately over alternatives (see whitepaper §1, §6) because its score decomposition is what makes `explainability` tractable without risking confabulation — every decision is already a named, inspectable sum, not a black box.

## Status

**Implemented (Phase 8).** Tested against mocked legal actions and StrategicIntents, with explicit latency benchmarking. Not yet wired into a live plugin/game loop — that happens during TOSIOS integration, after the Explainability subsystem (Phase 9).

## 1. Directory tree

```
decision-engine/
├── src/
│   ├── types.ts                    Domain types: DecisionInputs, Decision + its parts
│   ├── config.ts                   All tunables: awareness thresholds, personality weights, timing bounds
│   ├── errors.ts                   Typed error hierarchy (one class per failure mode)
│   ├── logger.ts                   Structured logging (same convention as every other AI-engine package)
│   ├── stats.ts                    clamp() — the one shared numeric primitive
│   ├── consideration.ts            Consideration interface + BaseConsideration (clamps to [0,1])
│   ├── registry.ts                 DecisionRegistry — registration/discovery/dependency ordering/execution
│   ├── awareness-budget.ts         Tier computation + input masking + AwarenessUsed tracking
│   ├── world-facts.ts              PublicGameState/StrategicIntent -> small symbolic fact bag
│   ├── evaluator.ts                Runs the registry against one action -> ActionScore
│   ├── selector.ts                 Picks the winner: deterministic tie-break or seeded exploration
│   ├── personality.ts              Resolves personality -> per-consideration weight multiplier
│   ├── decision-engine.ts          DecisionEngine — the public orchestrator, decide()
│   ├── considerations/
│   │   ├── tags.ts                 actionTags() — reads action.params.tags safely
│   │   ├── plan-adherence.ts       planAdherence  — aligns actions with StrategicIntent.category
│   │   ├── punish-opening.ts       tactical       — immediate tactical opening
│   │   ├── safety.ts               safety         — self-preservation at low health
│   │   ├── pattern-exploit.ts      exploit        — counters a visible confirmed/strong pattern
│   │   ├── profile-exploit.ts      exploit        — exploits a visible semantic-profile trait
│   │   ├── action-freshness.ts     mechanical     — legalUntil urgency
│   │   └── index.ts                registerAllConsiderations()
│   ├── index.ts                    Public API surface
│   └── __tests__/
│       ├── fixtures.ts                        Shared builders (buildEngine, buildAction, ...)
│       ├── registry.test.ts                   Registration, dependency ordering, failure isolation
│       ├── awareness-budget.test.ts           Tier mapping, masking, AwarenessUsed tracking
│       ├── decision-engine.test.ts            Selection, tie-breaking, personality, failures,
│       │                                       timeout, replay determinism, randomized scenarios,
│       │                                       performance benchmark
│       └── considerations/
│           ├── plan-adherence.test.ts
│           ├── tactical-and-safety.test.ts    punishOpening, safety, actionFreshness
│           └── exploit-and-mechanical.test.ts patternExploit, profileExploit
├── package.json
└── tsconfig.json
```

## 2. Decision architecture

```
DecisionInputs
      │
      ▼
validateStrategicIntent / validateLegalActions   (fail fast: InvalidStrategicIntentError,
      │                                            MalformedLegalActionsError, NoLegalActionsError)
      ▼
maskDecisionInputs (Awareness Budget)  ──►  MaskedDecisionInputs + AwarenessTier
      │
      ▼
buildWorldFacts                        ──►  DecisionWorldFacts (symbolic, tick-cadence)
      │
      ▼
for each legal action (wall-clock guarded by maxEvaluationMs):
      │
      ▼
  DecisionRegistry.evaluateAll          ──►  every registered Consideration scores THIS action
      │                                       (dependency-ordered, failure-isolated)
      ▼
  evaluateAction (weighted linear combination, personality-weighted)  ──►  ActionScore
      │
      ▼
selectBestAction (deterministic tie-break / seeded exploration)  ──►  winner + ranked alternatives
      │
      ▼
Decision { action, score, alternatives, metadata, reasoningTrace, executionTimestamp }
```

`DecisionEngine.decide()` contains no gameplay logic of its own — it only sequences the modules above, exactly the way `StrategyPlanner` sequences its own five modules with no AI logic of its own.

## 3. Decision Registry

`DecisionRegistry` is structurally the fourth instance of the same registry pattern already proven in this monorepo (player-modeling's `DimensionRegistry`, pattern-recognition's `PatternRegistry`, strategy-planner's `GoalRegistry`), operating on `Consideration`:

- **Registration** — `register(factory)`; rejects a duplicate `id` (`DuplicateConsiderationError`).
- **Discovery** — `list()` / `get(id)` / `has(id)` return `ConsiderationMetadata`.
- **Versioning** — `ConsiderationMetadata.version`, bumped whenever a consideration's scoring logic changes in a way that makes historical `ReasoningTrace` entries non-comparable.
- **Dependencies** — `ConsiderationMetadata.dependsOn`; `executionOrder()` topologically sorts via Kahn's algorithm (insertion order as tiebreak, so it's deterministic), throwing `UnknownConsiderationDependencyError` / `CyclicConsiderationDependencyError` for a bad graph. A dependent consideration reads an already-computed sibling's result through `ConsiderationContext.siblingResults` — it never touches another consideration's internals.
- **Metadata** — `id`, `displayName`, `category`, `version`, `dependsOn`, `description`, all readable via `list()`/`get()` without evaluating anything.
- **Execution / failure isolation** — `evaluateAll()` runs every consideration in dependency order; a thrown error is caught and recorded against that consideration only (`ConsiderationExecutionOutcome.error`), never aborting the rest of the pass.

Extending the platform means adding one new file under `src/considerations/` plus one line in `registerAllConsiderations()` — no existing consideration, the registry, the evaluator, or the selector ever needs to change.

## 4. Utility AI implementation

Six considerations are implemented, one per category:

| id | category | signal |
|---|---|---|
| `planAdherence` | planAdherence | action tags match `StrategicIntent.category` |
| `punishOpening` | tactical | `publicGameState.openingAvailable` + offense-tagged action |
| `safety` | safety | `selfHealthLow` + defensive/offensive-tagged action |
| `patternExploit` | exploit | action opts into `countersPatternCategory`, matched against a visible confirmed/strong pattern |
| `profileExploit` | exploit | action opts into `punishesAggression`/`pressuresLowSkill`, matched against a visible semantic-profile dimension |
| `actionFreshness` | mechanical | `Action.legalUntil` urgency (the one real SDK-contract field, not a genre convention) |

Every consideration returns `{ value: [0,1], reasoning }`, where **0.5 is the documented neutral "no opinion" value** — used whenever a consideration's opt-in signal (a tag, a `countersPatternCategory` field, a visible profile dimension) isn't present, never silently defaulted to 0 or 1, which would read as a strong opinion it doesn't actually have.

### Utility equation

For one action, `evaluateAction()` combines every consideration's result into a single utility via a **weighted linear combination** (whitepaper §12.2):

```
utility(action) = Σ (personalityWeight(c) · value(c, action))  /  Σ personalityWeight(c)
                     over every registered consideration c
```

`personalityWeight(c) = categoryWeight[personality][c.category] × considerationOverride[personality][c.id]` (default `1` for both), resolved once per (action, consideration) pair in `personality.ts` — **considerations never see which personality is active** (`ConsiderationContext` deliberately excludes it), so personality can only ever act as an external weight on an already-neutral score, never bias the raw read itself.

If the weight total is `0` (a pathological all-zero-weight config), utility falls back to `0.5` rather than dividing by zero.

## 5. Legal Action integration

- `legalActions` on `DecisionInputs` is typed `unknown`, not `Action[]` — it crosses a trust boundary (a third-party plugin) and must be validated before use.
- `validateLegalActions()` requires an array (`MalformedLegalActionsError` if not) and filters through `isAction()` from `@adaptive-ai/sdk-protocol`; individually malformed entries are dropped and counted in `DecisionMetadata.actionsSkippedMalformed` rather than failing the whole call.
- An empty (post-filter) legal-action list throws `NoLegalActionsError` — the engine can never invent a substitute action.
- The winning `Decision.action` is always a reference to one of the actions the plugin supplied — the engine never constructs, mutates, or synthesizes an `Action`.

## 6. Public API

```ts
import {
  DecisionEngine, DecisionEngineOptions,
  DecisionRegistry, registerAllConsiderations,
  loadDecisionEngineConfig, DecisionEngineConfig,
  DecisionInputs, Decision, DecisionScore, AlternativeCandidate,
  DecisionMetadata, ReasoningTrace,
  isDecisionEngineError, NoLegalActionsError, MalformedLegalActionsError,
  InvalidStrategicIntentError, /* ...one class per failure mode */
} from '@adaptive-ai/decision-engine';

const config = loadDecisionEngineConfig();
const registry = new DecisionRegistry();
registerAllConsiderations(registry, config);
const engine = new DecisionEngine({ registry, config });

const decision: Decision = engine.decide(inputs, Date.now());
// decision.action            -> submit through the SDK's decision channel
// decision.score              -> DecisionScore (utility, confidence, breakdown)
// decision.alternatives       -> AlternativeCandidate[] (full ranking)
// decision.metadata           -> DecisionMetadata (counts, timing, tie-break mode, tier)
// decision.reasoningTrace     -> ReasoningTrace (machine-readable, for `explainability`)
// decision.executionTimestamp -> the `now` the call was made with
```

`decide()` is a pure function of `(inputs, now)` plus the engine's own immutable `config`/`registry` — no hidden mutable state, no I/O, no wall-clock reads other than the `now` parameter and the timeout guard's own `Date.now()` polling.

## 7. Test coverage

55 tests across 6 files (`npm test`):

- **Registry** — registration/duplicate rejection, dependency ordering, cyclic/missing-dependency detection, failure isolation.
- **Awareness Budget** — tier mapping (beginner/veteran/expert), masking at each tier, `matchContext`/`publicGameState` never gated, `AwarenessUsed` tracking of exactly which dimensions/patterns were read.
- **Considerations** — each of the six, individually, across their opt-in/neutral/triggered branches.
- **Decision selection** — higher-utility action wins; every `Decision` field is populated.
- **Tie-breaking** — genuine ties broken by ascending `action.id`; non-ties report `tieBreak: 'none'`.
- **Personality** — same facts + different personality → different resulting action (aggressive vs. defensive); resolved weights recorded in `reasoningTrace.considerationWeights`.
- **Invalid input** — empty legal actions, non-array `legalActions`, individually malformed entries (skipped + counted), missing `goalId`, out-of-range `confidence`, unrecognized `personality`.
- **Timeout** — a deliberately slow consideration forces the wall-clock guard mid-evaluation; the engine still returns a valid `Decision` with `metadata.timedOut: true`.
- **Replay determinism** — identical `(inputs, now)` reproduces an identical `Decision` byte-for-byte (including `reasoningTrace`); Experimental's seeded exploration reproduces the same pick given the same seed.
- **Randomized scenarios** — 100 randomized legal-action-set/personality/game-state/awareness-budget combinations, asserting the selected action is always drawn from the legal set and utility always stays in `[0,1]`.
- **Performance benchmark** — see below.

## 8. Performance benchmarks

`DecisionEngine — performance benchmark` evaluates a 30-action legal set (6 considerations × 30 actions = 180 consideration evaluations) 50 times and asserts the per-call average stays under 20ms — well inside the `maxEvaluationMs` default (40ms) budget for this tick-cadence layer, on unoptimized `ts-node`/`vitest` execution (no JIT warmup control, no production build). In practice, wall-clock cost is dominated by `O(actions × considerations)` pure-function calls with no I/O; the `maxEvaluationMs` guard is a real backstop, not a theoretical one — see "Timeout handling" above.

## 9. Known limitations

- `ReasoningTrace.perActionBreakdown` is capped at `config.maxTracedActions` (default 10, highest-utility actions first) to keep the trace payload bounded for large legal-action sets; `perActionBreakdownTruncated` signals when this happened. Only the winning action's own breakdown (`Decision.score.breakdown`) is ever guaranteed complete.
- The timeout guard (`maxEvaluationMs`) is checked **between** actions, not preemptively inside a single consideration's `evaluate()` call — a single pathologically slow consideration can still overrun the budget once. Considerations are required to be pure/synchronous/cheap by convention (see `consideration.ts`), not sandboxed against it.
- `Action.params` is read via genre-specific opt-in conventions (`tags`, `countersPatternCategory`, `punishesAggression`, `pressuresLowSkill`) that a plugin must adopt for the corresponding consideration to have an opinion; a plugin that doesn't adopt them gets uniformly neutral (0.5) scores from those considerations, not an error.
- `explorationEpsilon` is nonzero only for the Experimental personality by default; every other personality is fully deterministic given the same inputs.
- Not yet exercised against a real plugin's `getLegalActions()` output — validated only against `@adaptive-ai/sdk-protocol`'s `isAction()` shape check and hand-built fixtures.

## 10. Integration points with the Explainability subsystem

`Decision.reasoningTrace` is deliberately **machine-readable, not natural language** — this phase produces the structured input the Explainability subsystem (Phase 9) will translate into human-facing explanations:

- `reasoningTrace.strategicIntentGoalId` — links back to the `StrategyPlanner`'s own `planningTrace` for a full plan → decision chain.
- `reasoningTrace.worldFacts` — the exact symbolic facts this decision was scored against.
- `reasoningTrace.considerationWeights` — the resolved per-consideration weight actually applied (personality already baked in), so Explainability can render "why did X matter more than Y" without re-deriving personality logic.
- `reasoningTrace.perActionBreakdown` — every (bounded) action's full per-consideration score decomposition, so Explainability can contrast the winner against its runner-up, not just narrate the winner in isolation.
- `reasoningTrace.awarenessUsed` — exactly which semantic dimensions/pattern ids were actually read this decision, so an explanation never leaks information the Awareness Budget was supposed to withhold.
- `Decision.alternatives` — the full ranked list (not just the top pick), for "what almost happened instead."
- `Decision.metadata` — `tieBreak`, `timedOut`, `awarenessTier`, `personality`, and the evaluation counts, for meta-level explanations ("this was a close call" / "the AI ran out of time to consider every option").

## Reference

`ADAPTIVE_AI_ENGINE_WHITEPAPER.md` §6 (Decision-Making Architecture, Layer 2), §9 (Personality), §7 (Awareness Budget), §12.2 (utility scoring), §12.11 (computational complexity).
