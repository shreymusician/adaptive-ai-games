# @adaptive-ai/event-pipeline

Canonical event ingestion — batching, validation, authentication, retries, and persistence.

## Responsibility

The single entry point every game plugin's events pass through before reaching any AI Engine module. Owns:

- **The canonical event envelope and taxonomy** (`PlayerMoved`, `PlayerDamaged`, `PlayerDied`, `AbilityUsed`, `TargetAcquired`, `DecisionPoint`, etc. — see `PLATFORM_V2_DESIGN.md` §4).
- **Batching** — plugins batch client-side (roughly every 250ms or on a buffer threshold) rather than sending one request per event.
- **Match-scoped authentication** — a short-lived token issued at `MatchStarted`, distinct from the long-lived session JWT, limiting blast radius if a token leaks and allowing per-match rate limiting independent of a player's other activity.
- **Validation** — schema-version-aware; malformed or out-of-order (`seq`) events are rejected or flagged, not silently accepted.
- **Persistence** — writes to the `gameplayEvents` collection, the append-only raw log every downstream AI Engine module ultimately derives from.

## Boundary

- **Input:** batched events from `@adaptive-ai/sdk-host` (relayed from the plugin iframe via `postMessage`).
- **Output:** persisted `gameplayEvents` records; a near-real-time stream consumed by `@adaptive-ai/behavior-analysis`.
- Does **not** interpret events — purely ingestion, validation, and storage. All behavioral interpretation happens downstream.

## Status

Architecture scaffold only (Phase 1). Phase 3 implements this module in full, verified against mock plugins emitting synthetic events — no real game integration required to validate it.

## Reference

`PLATFORM_V2_DESIGN.md` §4 (Event Schema), §9 (Security Model — match-scoped tokens).
