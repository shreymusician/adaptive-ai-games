# @adaptive-ai/difficulty-calibration

Gates how much of what the AI *knows* it is permitted to *act on* — never touches a game's numeric stats.

## Responsibility

Owns the **Awareness Budget**: a 0–1 scalar per match controlling how much of the Player Profile / Pattern Recognition / Strategy Planner's read `decision-engine` may use.

- At `0`: falls back to a competent-but-generic baseline reacting only to in-match working memory.
- At `1`: full use of every high-confidence pattern and dimension available.
- Rises with the player's accumulated history against this specific opponent — the platform-wide generalization of WARDEN's already-proven `depth` mechanic.
- Starts low for new players as a deliberate floor, independent of and in addition to naturally-low profile confidence.
- Should be surfaced to the Player Dashboard — the calibration itself is meant to be visible, not hidden, consistent with the platform's transparency principle.

**Hard constraint, restated:** this module must never influence a game's HP, damage, speed, or any other numeric stat. It only ever changes *which legal action* `decision-engine` is permitted to weight toward — the fairness boundary in the SDK makes any other channel structurally unavailable regardless.

## Boundary

- **Input:** match history length/outcomes against this opponent, current `PlayerProfile`/`Pattern` confidence levels.
- **Output:** the Awareness Budget scalar, consumed by `@adaptive-ai/decision-engine` as a weighting gate — never applied to game state directly.

## Status

Architecture scaffold only (Phase 1). Implementation deferred to a later phase (after the core Planner/Engine loop is proven per `ADAPTIVE_AI_ENGINE_WHITEPAPER.md` §6's phasing rationale) — this is a refinement on top of a working decision loop, not a blocker to proving the loop itself.

## Reference

`ADAPTIVE_AI_ENGINE_WHITEPAPER.md` §7 (Difficulty — Never Cheating, Only Revealing) in full.
