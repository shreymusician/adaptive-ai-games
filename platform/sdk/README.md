# Game Plugin SDK — Adaptive AI Platform

The Game Plugin SDK is the contract between game plugins and the Adaptive AI Platform. It enforces a fairness boundary: plugins run in sandboxed iframes and communicate via postMessage, ensuring the AI opponent cannot cheat by reading hidden state.

## Architecture

The SDK consists of three packages:

### 1. `@adaptive-ai/sdk-protocol`

**Types and messages for postMessage communication** — independent of both client and host, this package defines the wire format.

- **Canonical event types** (`MatchStarted`, `PlayerDamaged`, etc.)
- **Message types** (`EmitMessage`, `LegalActionsRequest`, etc.)
- **Validators** (parse/validate unknown postMessage data)
- **Version negotiation** constants

Used by both client and host. No runtime coupling between the two.

### 2. `@adaptive-ai/sdk-client`

**Runs inside the plugin iframe** — this is what your game loads and uses.

**Main export:** `createGameSDK(options)`

```typescript
import { createGameSDK } from '@adaptive-ai/sdk-client';

const sdk = createGameSDK({ targetOrigin: 'https://platform.example.com' });

// One-directional: plugin → platform
sdk.emit({ type: 'PlayerMoved', payload: { x: 10, y: 20 } });

// Request → Response: platform asks for legal actions
sdk.onLegalActionsRequest((entityId) => [
  { id: 'move-forward' },
  { id: 'attack' },
]);

// Request → Response: platform submits a decision
sdk.onDecision((entityId, action) => {
  applyActionToEntity(entityId, action);
});
```

**Lifecycle:**
- `createGameSDK()` — constructor (starts listening immediately)
- `isHandshakeDone()` — check if connected
- `emit()` — report events to platform
- `onLegalActionsRequest(provider)` — register handler for action queries
- `onDecision(handler)` — register handler for AI decisions
- `stop()` — stop listening (rarely used)

### 3. `@adaptive-ai/sdk-host`

**Runs in the platform's parent frame** — this is what the Player Dashboard uses to load plugins.

**Main export:** `mountPlugin(options)`

```typescript
import { mountPlugin, createPluginIframe, loadManifest } from '@adaptive-ai/sdk-host';

// Load manifest
const manifest = await loadManifest('https://game.example.com/manifest.json');

// Create and mount iframe
const { iframe, transport } = createPluginIframe(manifest, {
  container: document.getElementById('game-container'),
});

// Mount the plugin
const plugin = mountPlugin({
  transport,
  matchContext: {
    matchId: 'match-123',
    playerId: 'player-456',
    gameId: manifest.id,
    schemaVersion: '1',
  },
  onEvent: (event) => {
    // Canonical events land here
    console.log(event);
  },
});

// When needed, request an action or submit a decision
const actions = await plugin.requestLegalActions('entity-id');
const chosenAction = actions[0];
await plugin.submitDecision('entity-id', chosenAction);

// Cleanup
await plugin.unmount();
```

**Lifecycle:**
- `mountPlugin(options)` — establish connection, wait for handshake
- `requestLegalActions(entityId)` — request actions from plugin (promise-based, timeout-guarded)
- `submitDecision(entityId, action)` — tell plugin an action was chosen
- `unmount()` — disconnect, clean up

**Utilities:**
- `createPluginIframe(manifest, options)` — create an iframe with secure sandbox attributes
- `destroyPluginIframe(iframe)` — clean up and remove an iframe
- `loadManifest(url)` — fetch and validate a manifest.json

## Version Negotiation

Plugins and the platform exchange SDK versions during handshake:

1. Plugin sends `clientGreeting` with `sdkVersion` and `requestedSchemaVersion`
2. Platform responds with `hostGreeting` — accepted/rejected, agreed schema version
3. Both sides only proceed if compatible

**Compatibility:** `MAJOR.MINOR` must match; `PATCH` can differ.

If versions don't match, the `onHandshakeRejected` callback fires and the plugin cannot continue.

## Fairness Boundary

### What's Guaranteed

- **No shared memory** — only postMessage between iframe and parent
- **No object references** — everything is serialized JSON
- **No hidden state access** — the AI only sees what you emit
- **Identical input path** — AI decisions go through the same code path as human input

### Enforcement

1. **Sandbox iframe** — `sandbox="allow-scripts"` prevents DOM access, local storage, etc.
2. **SDK separation** — client and host are separate packages; host never imports client
3. **Message validation** — all postMessage data is parsed and validated; malformed messages are ignored, never crash
4. **Timeout guards** — if a plugin doesn't respond to a request within 2 seconds (configurable), the request is rejected, preventing the AI from waiting forever

### What's NOT Guaranteed (Yet)

- **Global object leaks** — a determined attacker could still access `window.parent` if it escapes the iframe (e.g., via `Function` constructor)
- **Timing attacks** — the plugin could measure response times to infer game state
- **These are engineering problems, not fundamental flaws** — future phases will address them with stricter CSP and worker-based isolation

## API Reference

### `@adaptive-ai/sdk-client`

#### `createGameSDK(options?: CreateGameSDKOptions): GameSDK`

Creates and starts the SDK immediately, connecting to the parent window.

**Options:**
- `targetOrigin?: string` — origin to restrict postMessage to (default: `'*'`)

**Returns:** started GameSDK instance

#### `sdk.emit(input: EmitEventInput): void`

Report an event to the platform. Must be called after handshake completes.

```typescript
sdk.emit({
  type: 'PlayerMoved',
  payload: { x: 10, y: 20 },
  ts: Date.now(), // optional
});
```

**Throws:** if called before handshake completes

#### `sdk.onLegalActionsRequest(provider: LegalActionsProvider): void`

Register a handler to return legal actions for an entity.

```typescript
sdk.onLegalActionsRequest((entityId) => [
  { id: 'move', params: { direction: 'forward' } },
]);
```

**Constraints:**
- Must return synchronously
- Should return < 100 actions for performance
- Empty array is valid (entity can't act)

#### `sdk.onDecision(handler: DecisionHandler): void`

Register a handler to apply a decision to an entity.

```typescript
sdk.onDecision((entityId, action) => {
  applyActionToEntity(entityId, action);
});
```

#### `sdk.isHandshakeDone(): boolean`

Check if the handshake with the platform has completed.

#### `sdk.getAgreedSchemaVersion(): string | null`

Get the event schema version agreed upon during handshake.

### `@adaptive-ai/sdk-host`

#### `mountPlugin(options: MountPluginOptions): MountedPlugin`

Establish a connection to a plugin and wait for handshake.

**Options:**
- `transport: HostTransport` — (required) communication layer (see `createPluginIframe`)
- `matchContext: MatchContext` — (required) match ID, player ID, game ID, schema version
- `onEvent: (event: CanonicalEvent) => void` — (required) callback for emitted events
- `targetOrigin?: string` — (default: `'*'`) origin for postMessage
- `requestTimeoutMs?: number` — (default: 2000) timeout for plugin requests
- `onHandshakeDone?: () => void` — callback when handshake completes
- `onHandshakeRejected?: (reason: string) => void` — callback if handshake fails

**Returns:** MountedPlugin (promise-like; waits for handshake before resolving)

#### `plugin.requestLegalActions(entityId: string): Promise<Action[]>`

Ask the plugin for legal actions for an entity.

**Returns:** promise that resolves with action array

**Throws:** `PluginRequestTimeoutError` if no response within timeout

```typescript
try {
  const actions = await plugin.requestLegalActions('boss');
  console.log(`Legal actions: ${actions.map((a) => a.id).join(', ')}`);
} catch (error) {
  if (error instanceof PluginRequestTimeoutError) {
    console.error('Plugin is not responding');
  }
}
```

#### `plugin.submitDecision(entityId: string, action: Action): Promise<void>`

Tell the plugin an action was chosen for an entity.

**Returns:** promise that resolves once the plugin acknowledges

**Throws:** `PluginRequestTimeoutError` if no acknowledgement within timeout

#### `plugin.unmount(): void`

Disconnect from the plugin. Any in-flight requests are rejected immediately.

```typescript
plugin.unmount();
// All pending requestLegalActions/submitDecision promises reject now
```

#### `createPluginIframe(manifest: GamePluginManifest, options?: IframeLoadOptions): { iframe, transport }`

Create a sandboxed iframe for a plugin.

**Options:**
- `container?: HTMLElement` — parent element to mount iframe into
- `attributes?: Record<string, string>` — additional iframe attributes

**Returns:** object with:
- `iframe: HTMLIFrameElement` — the created iframe
- `transport: WindowHostTransport` — ready to pass to `mountPlugin`

```typescript
const { iframe, transport } = createPluginIframe(manifest, {
  container: document.getElementById('game-container'),
});

const plugin = mountPlugin({ transport, ... });
```

#### `destroyPluginIframe(iframe: HTMLIFrameElement): Promise<void>`

Remove an iframe and clean up.

```typescript
await destroyPluginIframe(iframe);
// Iframe is removed from DOM, src is cleared
```

#### `loadManifest(url: string): Promise<GamePluginManifest>`

Fetch and validate a manifest.json.

**Returns:** validated manifest

**Throws:** if fetch fails, JSON is invalid, or schema is violated

```typescript
const manifest = await loadManifest('https://game.example.com/manifest.json');
```

#### `validateManifest(data: unknown): GamePluginManifest`

Validate a manifest object (already parsed).

**Returns:** validated manifest

**Throws:** if schema is violated

```typescript
const manifest = validateManifest(JSON.parse(manifestJson));
```

---

## Event Schema

### Canonical Events

| Type | Payload | Notes |
|------|---------|-------|
| `MatchStarted` | `{}` | Game started |
| `MatchEnded` | `{ winner?, loser?, reason? }` | Game ended |
| `PlayerMoved` | `{ from?, to?, speed? }` | Positional change |
| `PlayerDamaged` | `{ damage, targetHealth }` | Damage event |
| `PlayerDied` | `{ position?, itemsDropped? }` | Death event |
| `AbilityUsed` | `{ ability, target?, params? }` | Ability cast |
| `AbilityOnCooldownAttempt` | `{ ability }` | Cooldown blocked |
| `TargetAcquired` | `{ targetId, distance }` | Acquired target |
| `TargetSwitched` | `{ from, to }` | Changed target |
| `ItemPicked` | `{ itemId, itemName }` | Picked up item |
| `WeaponEquipped` | `{ weapon, slot? }` | Equipped weapon |
| `DecisionPoint` | `{ entityId, context? }` | Decision made here |

All payloads are JSON-serializable. The platform timestamps and sequences all events.

---

## Best Practices

1. **Keep events timely** — emit significant events, not every frame
2. **Use deterministic IDs** — reference entities by string ID, not object reference
3. **Handle timeouts** — assume decisions may never arrive or may be delayed
4. **Validate action params** — even though they came from you, the platform could've modified them
5. **Don't assume ordering** — events may be batched, reordered, or delayed

---

## Testing

### Unit Testing a Plugin

```typescript
import { GameSDK } from '@adaptive-ai/sdk-client';
import { FakeMessageTransport } from '@adaptive-ai/sdk-client/__tests__';

const transport = new FakeMessageTransport();
const sdk = new GameSDK(transport);

// Simulate handshake
transport.simulateHandshakeAccepted();

// Test event emission
sdk.emit({ type: 'PlayerMoved', payload: { x: 10, y: 20 } });
expect(transport.sent).toHaveLength(2); // greeting + emit
```

### Integration Testing with the Platform

Deploy your plugin, load it in the Player Dashboard, and monitor events. Use the admin panel to inspect the event stream and verify the AI is making decisions.

---

## Troubleshooting

### SDK Won't Connect

1. Check that `entryUrl` in the manifest points to a valid, accessible URL
2. Verify `targetOrigin` matches the platform origin (or use `'*'` for dev)
3. Check browser console for errors

### Events Not Showing Up

1. Call `emit()` only after `isHandshakeDone()` returns true
2. Verify the event type is in the canonical list (or custom events are allowed)
3. Check that the payload is JSON-serializable

### Decisions Never Arrive

1. Ensure `onLegalActionsRequest` is registered and returns non-empty actions
2. Ensure `supportsAIOpponent: true` in manifest
3. Check browser DevTools for postMessage errors

---

## Resources

- [Plugin Developer Guide](../../PLUGIN_DEVELOPER_GUIDE.md)
- [Example Plugin](../../plugins/example-dummy-game/)
- [Protocol Types](./protocol/src/types.ts)
- [Client Source](./client/src/)
- [Host Source](./host/src/)

---

## License

MIT
