# Archive — Proof-of-Concept Games

**Status: archived, historical only. Not part of the active development roadmap.**

WARDEN and THE FIVE were built to prove one thing: that a browser game's opponent AI can genuinely adapt to an individual player's behavior over time, using only observation — no hidden stat boosts, no cheating. That mission is complete. They are not being extended, balanced, or polished further.

## Contents

- `warden/warden.html` — real-time 1v1 dodge/combat game. The boss reads roll direction, preferred range, dodge timing, and swing greed.
- `the-five/the-five.html` — the player controls a raid boss against an AI-directed 5-hero squad that adapts target priority and positioning.

Both are self-contained, single-file HTML5 Canvas games with their own client-side `localStorage`-based memory — independent of the platform's account system. Both have already had their known bugs fixed (broken persistence, frame-rate-dependent speed, blurry high-DPI rendering, a stat-corruption edge case) as of the last active-development pass on this codebase.

## Relationship to the new platform

These games predate the Adaptive AI Engine / Plugin SDK architecture (see `PLATFORM_REDESIGN_PROPOSAL.md` and `PLATFORM_V2_DESIGN.md` at the project root) and are **not wired into it**. Their in-game "memory" system is a bespoke, one-off implementation, not an instance of the platform's shared engine.

**Open item:** the live frontend (`frontend/public/games/warden.html`, `frontend/public/games/the-five.html`, and the `/play/warden` / `/play/five` routes) still serves these exact games and remains playable in the running app as of this writing. Whether to keep that live for now (as the only playable content until a V1 platform game ships) or take it down immediately is a product decision, not made unilaterally here — see the open question in `PLATFORM_V2_DESIGN.md`.
