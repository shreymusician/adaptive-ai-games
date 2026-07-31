# @adaptive-ai/sdk-client

The half of the Game SDK that runs **inside the plugin's sandboxed iframe**.

## Responsibility

Exposes exactly three surfaces to a game plugin's own code, and nothing else — no direct access to platform internals, no way to read another plugin's or another player's data:

1. **Events API** — `emit(canonicalEvent)`, one-directional, plugin → platform, relayed via `postMessage` to `@adaptive-ai/sdk-host` in the parent frame.
2. **Legal Actions API** — the plugin implements `getLegalActions(entityId): Action[]`, queried by the host when an AI-controlled entity needs to decide something. Read-only from the platform's side.
3. **Metadata API** — static manifest declaration (`GamePluginManifest`), registered once, not queried at runtime.

Everything else — rendering, physics, the plugin's actual game logic and internal state shape — stays inside the plugin and is never touched by this SDK or anything on the other side of it.

## Why this boundary matters

There is no shared JS heap between a plugin and the platform — only `postMessage`. This is what makes "the AI never reads hidden state, never teleports, never receives impossible information" a structural guarantee rather than a convention: those failure modes require a capability (direct state access) that this SDK's design does not provide, by construction, not by policy.

## Status

Architecture scaffold only (Phase 1). Phase 2 implements this module in full — usable end-to-end before any AI Engine module exists, verified with a synthetic dummy plugin.

## Reference

`PLATFORM_V2_DESIGN.md` §3 (Plugin SDK Specification) in full, especially §3.3 (the fairness boundary, concretely).
