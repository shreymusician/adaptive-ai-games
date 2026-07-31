# @adaptive-ai/player-intelligence

Cross-game player profile aggregation — the platform pillar responsible for the platform gradually understanding a player, not just a single game.

## Responsibility

Maps each plugin's game-specific observations onto the canonical dimension taxonomy via a per-plugin mapping table (e.g., TOSIOS's "shots fired while retreating" and WARDEN's "swings into recovery window" both feed the shared `riskTolerance` dimension, with different weights). This is what makes a player's day-one experience of a *second* game already feel informed by their history with the *first*.

**Eligibility rule for cross-game promotion** (stated once, checkable, not a per-plugin judgment call): a dimension is only eligible if it can be defined purely in terms of the canonical event schema, independent of any specific plugin's payload semantics. See `ADAPTIVE_AI_ENGINE_WHITEPAPER.md` §11 for the full transfers/stays-per-game breakdown (reaction time, risk tolerance, aggression, decision speed, mechanical skill, and strategic thinking transfer; favorite weapon, named patterns, and escape routes stay per-game).

## Boundary

- **Input:** per-game `PlayerProfile` data from `@adaptive-ai/player-modeling` across every plugin a player has touched.
- **Output:** the cross-game `PlayerProfile.crossGame` view, consumed by `strategy-planner` (for the "meta" read on a new plugin) and the Player Dashboard's "Player Card."
- Distinct from `player-modeling`: that module computes a single game's dimensions from that game's events; this module reconciles *across* games.

## Status

Architecture scaffold only (Phase 1). Implementation deferred until at least two plugins exist to validate the mapping-table approach against real data (per `PLATFORM_V2_DESIGN.md` §10, Phase 3 "Cross-game intelligence").

## Reference

`ADAPTIVE_AI_ENGINE_WHITEPAPER.md` §11 (Cross-Game Intelligence), `PLATFORM_V2_DESIGN.md` §5.3 and §8.
