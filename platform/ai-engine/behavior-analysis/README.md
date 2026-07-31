# @adaptive-ai/behavior-analysis

Stream processors that consume the canonical gameplay event stream (one match at a time) and derive raw behavioral signal — the first stage of the Adaptive AI Engine pipeline.

## Responsibility

One processor per behavioral dimension (movement, timing, targeting, risk exposure, etc.), each stateless per batch: a match's events can be processed independently and reprocessed later if a dimension's analysis logic improves, without needing to replay the actual game. Output is raw per-match observations, not yet a persisted profile — that aggregation step belongs to `@adaptive-ai/player-modeling`.

## Boundary

- **Input:** canonical events from `@adaptive-ai/event-pipeline`.
- **Output:** per-match observation deltas, consumed by `@adaptive-ai/player-modeling` and `@adaptive-ai/pattern-recognition`.
- Does **not** persist anything itself, does **not** know about specific players' history — purely a per-match transform.

## Status

Architecture scaffold only (Phase 1). Processing logic is implemented in Phase 5–6, driven by the event schema and dimension definitions in `ADAPTIVE_AI_ENGINE_WHITEPAPER.md` §3.2 and §5.

## Reference

`ADAPTIVE_AI_ENGINE_WHITEPAPER.md` §3.1 (update model), §5 (pattern detection methods) — this module produces the raw signal both consume.
