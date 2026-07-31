# @adaptive-ai/explainability

Produces human-readable, causally-accurate explanations of what the AI decided and why. **No generative AI** — a deterministic readout of real stored state.

## Responsibility

**Hard constraint:** explanations must be generated *from* the actual `Decision` trace recorded by `decision-engine`, never from a separate post-hoc "explain yourself" generative step. Post-hoc generation risks *confabulation* — a plausible-sounding explanation that isn't causally connected to what actually happened — which would be an existential credibility risk for a platform whose entire differentiator is proving the adaptation is real.

This is tractable specifically because `decision-engine` uses Utility AI: every decision is already a decomposable weighted sum of named considerations, so an explanation is close to a templated readout of "which consideration(s) dominated," filled with the real numbers and the real `Pattern`/`PlayerProfile` entries that fed them.

Two tiers:
1. **Pattern-level** — "I noticed you always dodge left." Near-direct readout of a trusted `pattern-recognition` entry.
2. **Decision-level** — "I predicted your movement because you rushed weakened enemies four times in a row." Requires joining the specific `Decision` trace's dominant considerations against the `Pattern`/`PlayerProfile` entries that fed them — the harder, more valuable case.

## Boundary

- **Input:** `Decision` trace records (including `planSnapshot`) from `decision-engine`, `Pattern` records from `pattern-recognition`, episodic entries from `long-term-memory`.
- **Output:** natural-language explanation strings, surfaced via the Player Dashboard and post-match summaries. Generated lazily on request, not for every decision (cost/volume tradeoff).

## Status

Architecture scaffold only (Phase 1). Phase 9 implements this module — explicitly required to produce a deterministic explanation for every decision, with no generative-AI component anywhere in the pipeline.

## Reference

`ADAPTIVE_AI_ENGINE_WHITEPAPER.md` §8 (Explainability) in full.
