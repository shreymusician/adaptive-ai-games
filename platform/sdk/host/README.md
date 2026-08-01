# @adaptive-ai/sdk-host

The half of the Game SDK that runs **in the platform's parent frame** — mounts plugins and enforces the fairness boundary from the outside.

## Responsibility

- **Mounts plugin iframes** with secure sandbox attributes
- **Loads and validates** plugin manifests
- **Relays events** from plugins to the Event Pipeline
- **Routes decisions** from the AI Engine to plugins
- **Enforces fairness** — plugins can only emit events and respond with legal actions; the platform never reads internal game state

## Exports

### Core

- `mountPlugin(options)` — establish connection to a plugin, wait for handshake
  - `requestLegalActions(entityId)` — ask plugin for actions (promise-based, timeout-guarded)
  - `submitDecision(entityId, action)` — tell plugin what the AI decided
  - `unmount()` — disconnect and clean up

### Utilities

- `createPluginIframe(manifest, options)` — create sandboxed iframe with secure attributes
- `destroyPluginIframe(iframe)` — remove iframe and clean up
- `loadManifest(url)` — fetch and validate manifest.json
- `validateManifest(data)` — validate a manifest object
- `WindowHostTransport` — production transport (uses `postMessage` on real window/iframe)

## Why This Exists Separately from `sdk-client`

`sdk-client` is untrusted code (runs inside third-party plugins). `sdk-host` is trusted platform code. Keeping them as separate packages with a `postMessage`-only contract means the trust boundary is also a dependency boundary — the host never imports the client, and never assumes anything the client claims.

## Trust Model

```
┌──────────────────────────────┐
│   Platform (trusted)         │
│                              │
│  ┌────────────────────────┐  │
│  │  @adaptive-ai/sdk-host │  │◄──── Only talks to
│  └────────────────────────┘  │      Plugin via
│             │                │      postMessage
│             │ postMessage    │      (never direct
│             │                │       memory access)
└─────────────┼────────────────┘
              │
        ┌─────┴────────┐
        │              │
   ┌────▼─────┐  ┌────▼──────┐
   │ Plugin 1  │  │ Plugin 2   │
   │ (iframe)  │  │ (iframe)   │
   └──────────┘  └────────────┘
```

## Handshake Protocol

1. Plugin sends `clientGreeting` with SDK version and requested schema version
2. Host validates SDK version compatibility (MAJOR.MINOR must match)
3. Host responds with `hostGreeting` — accepted/rejected, agreed schema version
4. Both sides proceed only if handshake succeeds

See [version.ts](./src/../protocol/src/version.ts) for compatibility logic.

## Sandbox Attributes

Iframes are created with `sandbox="allow-scripts"`, deliberately omitting:
- `allow-same-origin` — plugins can't access parent's localStorage/cookies
- `allow-top-level-navigation` — plugins can't redirect the browser
- `allow-pointer-lock` — plugins can't lock the cursor

Some plugins might need `allow-same-origin` for asset loading; this is evaluated per-plugin and documented in the manifest.

## Error Handling

### Plugin Request Timeouts

If a plugin doesn't respond to `requestLegalActions` or `submitDecision` within the timeout (default 2000ms):
- The request is rejected with `PluginRequestTimeoutError`
- In-flight decisions are aborted
- The plugin remains connected; subsequent requests may still work

### Handshake Failures

If the plugin's SDK version is incompatible:
- The `onHandshakeRejected` callback fires with the rejection reason
- The plugin is marked as unconnected
- No events are relayed until a new `mountPlugin` is called

### Malformed Messages

If a plugin sends an invalid message:
- The message is parsed and validated
- If validation fails, the message is silently ignored
- The connection remains open; the plugin isn't penalized

This defensive approach prevents buggy/malicious plugins from crashing the host.

## API Reference

See [../README.md](../README.md) for complete API docs.

Key methods:

```typescript
// Mount a plugin
const plugin = mountPlugin({
  transport,           // HostTransport from createPluginIframe
  matchContext,        // match ID, player ID, game ID, schema version
  onEvent,             // callback for emitted events
  targetOrigin,        // origin for postMessage (default '*')
  requestTimeoutMs,    // request timeout (default 2000)
  onHandshakeDone,     // optional callback when connected
  onHandshakeRejected, // optional callback if rejected
});

// Request actions
const actions = await plugin.requestLegalActions('entity-id');

// Submit a decision
await plugin.submitDecision('entity-id', chosenAction);

// Cleanup
plugin.unmount();
```

## Testing

Unit tests use `FakeHostTransport`, which simulates postMessage without a real iframe:

```typescript
const transport = new FakeHostTransport();
const plugin = mountPlugin({ transport, matchContext, onEvent: vi.fn() });

// Simulate plugin handshake
transport.simulateIncoming({
  channel: 'adaptive-ai-sdk/v1',
  kind: 'clientGreeting',
  sdkVersion: '0.1.0',
  requestedSchemaVersion: '1',
});

// Simulate plugin emitting an event
transport.simulateIncoming({
  channel: 'adaptive-ai-sdk/v1',
  kind: 'emit',
  seq: 1,
  event: { type: 'PlayerMoved', payload: { x: 1, y: 2 } },
});
```

See `src/__tests__` for comprehensive examples.

## Performance

- **Handshake:** ~1-5ms (local, no network)
- **Event emission:** ~0.1ms (just postMessage)
- **Legal actions request:** ~1-2ms (round-trip postMessage + plugin response time)
- **Memory:** ~50-100KB per mounted plugin (iframe overhead + SDK state)

Large action lists (100+ actions) slow down the AI Engine's decision time; keep under 10-20 per decision point.

## Reference

`PLATFORM_V2_DESIGN.md` §3 (Plugin SDK), §3.3 (fairness boundary), §9 (Security Model)
