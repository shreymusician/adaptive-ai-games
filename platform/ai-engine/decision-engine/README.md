# @adaptive-ai/decision-engine

The tick-rate layer of the Decision Architecture, and the **only** AI Engine module permitted to call back through the Plugin SDK boundary.

## Responsibility

Given the plugin's currently-legal actions (`getLegalActions()`) and the active `Plan`/`Intent` from `strategy-planner`, scores every candidate action via **Utility AI** — a weighted sum of named considerations (current plan alignment, Player Profile dimensions, active Personality weights, immediate tactical state) — and submits the highest-scoring (or weighted-random) choice through the SDK's `submitDecision` channel, the identical path human input travels through.

This is the direct analog of Alien: Isolation's "Xenomorph" executor: genuinely constrained to only what the plugin's declared interface exposes, never given anything beyond intent from the layer above it.

Utility AI was chosen deliberately over alternatives (see whitepaper §1, §6) because its score decomposition is what makes `explainability` tractable without risking confabulation — every decision is already a named, inspectable sum, not a black box.

## Boundary

- **Input:** `getLegalActions()` from the plugin (via `@adaptive-ai/sdk-host`), the active Plan from `strategy-planner`, weights from `opponent-personality`, the Awareness Budget from `difficulty-calibration`.
- **Output:** one `Action`, submitted via the SDK; a `Decision` trace record (winning considerations + scores + plan snapshot) persisted for `explainability`.
- Computational budget: `O(actions × considerations)` per tick — must stay real-time-safe; a "last known good decision" fallback is required so a slow round-trip never blocks the game loop.

## Status

Architecture scaffold only (Phase 1). Phase 8 implements this module tested against mocked legal actions, with explicit latency benchmarking.

## Reference

`ADAPTIVE_AI_ENGINE_WHITEPAPER.md` §6 (Decision-Making Architecture, Layer 2), §12.11 (computational complexity).
