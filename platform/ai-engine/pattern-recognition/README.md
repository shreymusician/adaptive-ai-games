# @adaptive-ai/pattern-recognition

Detects discrete, nameable habits — as distinct from `player-modeling`'s continuous dimensions.

## Responsibility

Where Player Modeling tracks *continuous* traits ("aggression: 0.84"), Pattern Recognition finds *discrete claims* ("reloads after exactly two shots," "always checks the same escape route"). These need sequence/frequency mining over the event log, not a running average.

**Promotion gate** — a pattern is only surfaced once both hold:
1. A minimum sample count (tunable per pattern type, roughly 8–10 for fast-cycling patterns).
2. Statistical concentration meaningfully above a uniform-random baseline (guards against promoting noise as a "habit").

**Trust model is deliberately asymmetric:** confidence grows on the same `1 − e^(−n/k)` curve as continuous dimensions, but *decays faster than it grows* when new observations contradict an established pattern — an AI that keeps "predicting" a habit the player has visibly patched reads as dumb, not smart, so contradiction must be detected quickly.

One pattern type (bait susceptibility) requires explicit plugin cooperation — the plugin must flag a `DecisionPoint` as a deliberate feint in its payload — flagged here so it isn't assumed free for every plugin.

## Boundary

- **Input:** canonical events (directly, for sequence mining) and `@adaptive-ai/behavior-analysis` output.
- **Output:** `Pattern` records (`{id, description, confidence, occurrences, distributionHistogram}`), persisted via `@adaptive-ai/memory-engine`'s `playerPatterns` collection, consumed by `@adaptive-ai/strategy-planner` and `@adaptive-ai/explainability`.

## Status

Architecture scaffold only (Phase 1). Phase 6 implements and tests every pattern type from `ADAPTIVE_AI_ENGINE_WHITEPAPER.md` §5.1 independently against simulated gameplay data — no real game integration yet.

## Reference

`ADAPTIVE_AI_ENGINE_WHITEPAPER.md` §5 (Pattern Recognition) in full.
