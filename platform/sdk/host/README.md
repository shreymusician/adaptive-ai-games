# @adaptive-ai/sdk-host

The half of the Game SDK that runs **in the platform's parent frame** — mounts plugins and enforces the fairness boundary from the outside.

## Responsibility

- Mounts a plugin's static bundle into a sandboxed `<iframe>` (`sandbox="allow-scripts"`, deliberately restrictive — evaluated per-plugin whether `allow-same-origin` is needed at all).
- Relays `postMessage` traffic in both directions: forwards `emit()` calls from `@adaptive-ai/sdk-client` to `@adaptive-ai/event-pipeline`; forwards `getLegalActions`/`submitDecision` round-trips between `@adaptive-ai/decision-engine` and the plugin.
- Is the **only** thing that talks to a mounted plugin — no other platform code holds a reference to the iframe.
- Enforces that a plugin can only ever be asked for `getLegalActions` and only ever told `submitDecision` — no other call shape exists on this bridge.

## Why this half exists separately from `sdk-client`

`sdk-client` is untrusted code (it runs inside the plugin, which may be third-party, vendored code we didn't write). `sdk-host` is trusted platform code. Keeping them as separate packages with a `postMessage`-only contract between them means the trust boundary in the design docs is also a boundary in the dependency graph — the host never imports the client, and nothing about the host assumes anything the client-side code claims about itself.

## Status

Architecture scaffold only (Phase 1). Phase 2 implements this module in full, alongside `sdk-client`, verified against a synthetic dummy plugin before any real game is involved.

## Reference

`PLATFORM_V2_DESIGN.md` §3.3 (the fairness boundary, concretely), §9 (Security Model).
