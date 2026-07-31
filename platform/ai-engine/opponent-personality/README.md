# @adaptive-ai/opponent-personality

A stylistic layer over `decision-engine`'s scoring — same underlying knowledge, different weighting, never different knowledge.

## Responsibility

Owns named presets of Utility AI consideration weight vectors (Aggressive, Patient, Hunter, Defensive, Psychological, Tactical, Experimental — see whitepaper §9 for the full weighting table). The same read on a player ("rushes low-HP targets, 84% confidence") produces different in-game behavior depending on which personality is active, because the *scoring function* differs, not the model. Direct precedent: Civilization's per-leader "flavor" system over identical underlying evaluation machinery.

`Experimental` is not just a selectable flavor — it adds a controlled exploration term (epsilon-greedy-style) as a structural hedge against the AI itself becoming fully predictable once players learn to read its tendencies, and the whitepaper recommends a small version of this term even on "serious" personalities, not only the dedicated Experimental preset.

## Boundary

- **Input:** none beyond a selected personality ID — this module holds static, hand-tuned (for now, see whitepaper §12.13/§12.15) weight presets.
- **Output:** a consideration-weight vector, consumed by `@adaptive-ai/decision-engine` and, optionally, `strategy-planner`.

## Status

Architecture scaffold only (Phase 1). Implementation deferred until after the core Decision Engine loop (Phase 8) is proven — personality is a layer on top of working scoring, not a prerequisite for it.

## Reference

`ADAPTIVE_AI_ENGINE_WHITEPAPER.md` §9 (Personality) in full, §2 (Civilization precedent).
