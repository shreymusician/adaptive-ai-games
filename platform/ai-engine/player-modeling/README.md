# @adaptive-ai/player-modeling

Turns `@adaptive-ai/behavior-analysis` output into the structured `PlayerProfile` — the platform's canonical, game-agnostic model of an individual player.

## Responsibility

Owns the general update model shared by every continuous dimension (reaction time, aggression, risk tolerance, etc.):

```
value_new  = value_old + α · (observation − value_old)     // EWMA
confidence = 1 − e^(−samples / k)                            // asymptotic
α          = 1 / (1 + samples)  [bounded below by α_min]
```

This is a direct, deliberate generalization of the `depth` mechanic already proven out in the archived WARDEN/THE FIVE prototypes — not a new invention. `k` is tunable per dimension (stable traits like reaction time use a larger `k`; context-sensitive ones like "favorite ability this patch" use a smaller one).

Because Player Modeling operates purely on the canonical event schema, it is what makes cross-game intelligence possible without bespoke per-game-pair glue code.

## Boundary

- **Input:** observation deltas from `@adaptive-ai/behavior-analysis`.
- **Output:** the `PlayerProfile` (per-game and cross-game dimension values + confidence), persisted via `@adaptive-ai/memory-engine`, consumed by `@adaptive-ai/strategy-planner` and `@adaptive-ai/decision-engine`.
- Does **not** decide what to do with the profile — that's `strategy-planner`'s job.

## Status

Architecture scaffold only (Phase 1). Phase 5 implements and unit-tests every behavioral dimension from `ADAPTIVE_AI_ENGINE_WHITEPAPER.md` §3.2 against recorded/simulated events.

## Reference

`ADAPTIVE_AI_ENGINE_WHITEPAPER.md` §3 (Player Modeling Framework) in full — this module is a direct implementation of that section.
