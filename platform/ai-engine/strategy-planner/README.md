# @adaptive-ai/strategy-planner

The slow-cadence layer of the Decision Architecture — produces a match-scoped abstract intent, never touches per-tick game state.

## Responsibility

Consumes `player-modeling` + `pattern-recognition` output and produces a plan like `{focus: 'healer-first', posture: 'ambush', confidence: 0.7}`. Runs once per match or every few seconds, never per-tick.

Algorithm is **plugin-tunable**: for genres with rich multi-step tactics, a bounded-depth GOAP-style forward search over a small *abstract* action space (`{pressure, regroup, flank, bait, defend, ...}` — never the game's full legal-action set) is worth the cost since it runs rarely. For simpler genres, a scored-priority list is sufficient and full GOAP would be overhead. The algorithm varies; the **interface** (produces an abstract Plan/Intent object) is fixed platform-wide.

This is the direct analog of Alien: Isolation's omniscient "Director" — it may hold the full learned read on a player, but it only ever passes *intent* downstream, never raw state.

## Boundary

- **Input:** `PlayerProfile` from `player-modeling`, `Pattern` records from `pattern-recognition`, active `@adaptive-ai/opponent-personality` weights.
- **Output:** an abstract `Plan`/`Intent` object, consumed by `@adaptive-ai/decision-engine`. Never calls back through the plugin SDK boundary directly — only `decision-engine` does that.

## Status

Architecture scaffold only (Phase 1). Phase 7 implements and tests this module using mocked player profiles — no plugins yet.

## Reference

`ADAPTIVE_AI_ENGINE_WHITEPAPER.md` §2 (Alien: Isolation precedent), §6 (Decision-Making Architecture recommendation, Layer 1).
