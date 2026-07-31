# @adaptive-ai/long-term-memory

Governs retention and confidence decay across a player's entire history — the *behavior*, as distinct from `memory-engine`'s *mechanism*.

## Responsibility

Decides how much an observation from 40 matches ago still counts versus one from last night, and whether that decay rate should differ per dimension (a stable trait like reaction time should decay slowly; something patch-sensitive like "favorite ability this season" should decay faster so the AI doesn't cling to a stale read after the underlying game changes).

Also owns the salience-gating logic for the bounded episodic-memory store (`playerEpisodes`) — deciding which specific encounters are significant enough to keep as nameable, callback-able memories (the Nemesis System pattern) versus which fold into aggregate semantic statistics and are otherwise discarded in specific-episode form.

## Boundary

- **Input:** the full observation/decision history available via `@adaptive-ai/memory-engine`.
- **Output:** decay-adjusted confidence values (feeding back into `player-modeling`'s stored dimensions) and the curated episodic-memory set (feeding `explainability`).
- Runs on a daily/batch cadence (per `ADAPTIVE_AI_ENGINE_WHITEPAPER.md` §10), not per-match.

## Status

Architecture scaffold only (Phase 1). Implementation deferred until Player Modeling (Phase 5) and Pattern Recognition (Phase 6) exist to decay in the first place.

## Reference

`ADAPTIVE_AI_ENGINE_WHITEPAPER.md` §4 (episodic vs. semantic memory), §5.2 (pattern trust/decay model), §10 (learning cadence).
