# @adaptive-ai/memory-engine

The persistence and retrieval mechanism for everything the platform has observed about a player.

## Responsibility

Distinguished deliberately from `@adaptive-ai/long-term-memory`: this module is the **mechanism** (read/write, indexing, retention policy, schema versioning, migrations), not the **behavior** (what gets kept vs. decayed, and how confidence ages over time — that reasoning lives in `long-term-memory`). Memory Engine owns four components, per `ADAPTIVE_AI_ENGINE_WHITEPAPER.md` §4:

- **Working memory** — current match's live state (ephemeral, in-process, not this module's concern to persist).
- **Short-term memory** — current match's accumulated raw observations before promotion.
- **Long-term semantic memory** — the persisted `PlayerProfile` dimension values.
- **Long-term episodic memory** — a bounded, salience-ranked store of specific notable encounters (the Nemesis-System pattern).

## Boundary

- **Input:** observation deltas from `@adaptive-ai/behavior-analysis`, confidence updates from `@adaptive-ai/player-modeling`.
- **Output:** retrieval APIs consumed by every downstream AI Engine module that needs "what do we know about this player."
- Owns schema versioning and migrations for all AI-engine-owned MongoDB collections (`playerProfiles`, `playerPatterns`, `playerEpisodes`).

## Status

Architecture scaffold only (Phase 1). Phase 4 implements persistence only — retrieval, versioning, migrations, and confidence-update mechanics, with **no intelligence** (no behavioral analysis logic lives here, only storage and update primitives).

## Reference

`ADAPTIVE_AI_ENGINE_WHITEPAPER.md` §4 (memory system design), `PLATFORM_V2_DESIGN.md` §6 (database schema) plus the `playerEpisodes` schema note flagged at the end of the whitepaper.
