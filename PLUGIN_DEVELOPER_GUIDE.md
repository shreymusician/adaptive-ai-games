# Plugin Developer Guide — Adaptive AI Platform SDK

This guide explains how to build a game plugin for the Adaptive AI Platform. Plugins run in a sandboxed iframe and communicate with the platform via the Game SDK to report events, expose legal actions for AI-controlled entities, and receive AI decisions to apply them.

---

## Table of Contents

1. [Overview](#overview)
2. [Core Concepts](#core-concepts)
3. [Getting Started](#getting-started)
4. [Manifest](#manifest)
5. [SDK Integration](#sdk-integration)
6. [Events API](#events-api)
7. [Legal Actions API](#legal-actions-api)
8. [Decision API](#decision-api)
9. [Best Practices](#best-practices)
10. [Testing](#testing)
11. [Troubleshooting](#troubleshooting)

---

## Overview

The Adaptive AI Platform consists of:

- **Platform**: Runs the Player Dashboard, AI Engine, and Event Pipeline (in the parent frame)
- **Plugin (your game)**: Runs in a sandboxed iframe and exposes three surfaces:
  1. **Events** — report what's happening in the game
  2. **Legal Actions** — declare what an entity is allowed to do
  3. **Metadata** — static manifest with game info

The SDK enforces a fairness boundary: the platform never reads your game's internal state, only what you explicitly emit. The AI opponent acts through the same input channel as a human player.

---

## Core Concepts

### Fairness Boundary

The SDK runs in two halves:

- **`@adaptive-ai/sdk-client`** — runs inside your plugin iframe (untrusted)
- **`@adaptive-ai/sdk-host`** — runs in the platform's parent frame (trusted)

Communication happens only via `postMessage`, never via shared memory. This means:

- The AI cannot cheat by reading hidden state
- The AI cannot access other players' data
- The AI acts through the same input path human players use

### Events

An **event** is a fact about something that happened in the game. Examples:

- `PlayerMoved` — a player's character moved to a new position
- `PlayerDamaged` — a player took damage
- `PlayerDied` — a player died
- `AbilityUsed` — an ability was activated

Events are one-directional: your plugin emits them, the platform consumes them for analytics and learning.

### Legal Actions

A **legal action** is something an entity (usually an AI-controlled character) is allowed to do *right now*. Examples:

- A boss standing still can `Attack`, `Move Forward`, or `Defend`, but not `Use Ability (on cooldown)`
- A player with 0 health cannot take any actions

When the platform's AI Engine needs to decide what an entity should do, it asks your plugin for the full list of legal actions, then picks one and submits it back through the same input path a human would use.

### Manifest

The **manifest** (`manifest.json`) declares static metadata about your plugin:

- Game ID and display name
- Version and upstream version
- SDK version compatibility
- Event schema version
- License

---

## Getting Started

### 1. Add the SDK to Your Project

If you're using a bundler (Vite, Webpack, esbuild):

```bash
npm install @adaptive-ai/sdk-client
```

If not, you'll need to either:
- Build the SDK to a single JS file and load it via `<script>`
- Or use a CDN build (not yet available; on the roadmap)

### 2. Create a Manifest

Create `manifest.json` in your plugin directory:

```json
{
  "id": "my-game",
  "displayName": "My Awesome Game",
  "version": "1.0.0",
  "upstreamVersion": "abc123def",
  "entryUrl": "https://my-game.example.com/game.html",
  "eventSchemaVersion": "1",
  "supportsAIOpponent": true,
  "legalActionSpace": "my-game-actions-v1",
  "license": {
    "spdxId": "MIT",
    "noticeUrl": "https://raw.githubusercontent.com/.../LICENSE",
    "upstreamRepo": "https://github.com/..."
  }
}
```

**Field explanations:**

- `id`: Unique identifier, no spaces/special chars (used in URLs)
- `displayName`: Human-readable name shown in the dashboard
- `version`: Your adapter version (semver, independent of the upstream game's version)
- `upstreamVersion`: The vendored upstream game's commit/tag for audit trail
- `entryUrl`: Full URL to your game's entry HTML/bundle (loaded in the iframe)
- `eventSchemaVersion`: Which canonical event taxonomy version you target (currently `"1"`)
- `supportsAIOpponent`: `true` if you implement legal actions and decision handling
- `legalActionSpace`: Identifier for your action schema (used in docs/schemas)
- `license`: SPDX ID + where upstream license lives + upstream repo URL

### 3. Initialize the SDK

In your game's main JS file:

```typescript
import { createGameSDK } from '@adaptive-ai/sdk-client';

// Create and start the SDK (connects to parent frame)
const sdk = createGameSDK({
  targetOrigin: 'https://platform.example.com', // or '*' for dev
});

// Register handlers (see below)
sdk.onLegalActionsRequest((entityId) => {
  // Return legal actions for this entity
});

sdk.onDecision((entityId, action) => {
  // Apply the AI's decision
});
```

Or, if not using a bundler, wait for `window.GameSDK` to be available and instantiate it directly. (See `@adaptive-ai/sdk-client` README for the non-bundled pattern.)

---

## Manifest

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | ✓ | Unique game ID, no spaces/special chars |
| `displayName` | string | ✓ | Human-readable name |
| `version` | string | ✓ | Adapter version (semver) |
| `upstreamVersion` | string | ✓ | Vendored game's commit/tag |
| `entryUrl` | string | ✓ | Full URL to game HTML/bundle |
| `eventSchemaVersion` | string | ✓ | Canonical event taxonomy version |
| `supportsAIOpponent` | boolean | ✓ | Supports AI opponents |
| `legalActionSpace` | string | ✓ | Your action schema ID |
| `license.spdxId` | string | ✓ | SPDX license identifier |
| `license.noticeUrl` | string | ✓ | URL to upstream license text |
| `license.upstreamRepo` | string | ✓ | GitHub/etc repo URL |

### Example

See `plugins/example-dummy-game/manifest.json` for a complete example.

---

## SDK Integration

### Initialization

The SDK must be created and started before you can use any features.

```typescript
import { createGameSDK } from '@adaptive-ai/sdk-client';

const sdk = createGameSDK({
  targetOrigin: window.location.origin, // or '*' in dev
});

// Now you can use sdk.emit(), register handlers, etc.
```

**Optional:** Check the handshake status before using the SDK:

```typescript
if (!sdk.isHandshakeDone()) {
  console.log('Waiting for handshake...');
}
const agreedSchema = sdk.getAgreedSchemaVersion(); // '1', etc
```

### Error Handling

If the handshake is rejected, an error event is thrown on the SDK:

```typescript
import { GameSDK, HandshakeRejectedError } from '@adaptive-ai/sdk-client';

try {
  const sdk = createGameSDK();
} catch (error) {
  if (error instanceof HandshakeRejectedError) {
    console.error('Platform rejected your plugin:', error.message);
    // Show an error UI to the player
  }
}
```

---

## Events API

### Emit an Event

```typescript
sdk.emit({
  type: 'PlayerMoved',
  payload: { x: 10, y: 20, from: { x: 0, y: 0 } },
  ts: Date.now(), // optional, defaults to now
});
```

**Important:**
- Only emit after the handshake completes (`isHandshakeDone()` returns true)
- Call `emit()` from your game's core loop/event handlers, not in every frame
- The platform timestamps the event, but you can override it if needed

### Canonical Event Types

These are the events the platform recognizes and indexes for analytics:

| Type | Payload Schema | When to Emit |
|------|---|---|
| `MatchStarted` | `{}` | Game started |
| `MatchEnded` | `{ winner?, loser?, reason? }` | Game ended |
| `PlayerMoved` | `{ from?, to?, speed? }` | Player moved |
| `PlayerDamaged` | `{ damage, targetHealth }` | Damage dealt |
| `PlayerDied` | `{ position?, itemsDropped? }` | Player died |
| `AbilityUsed` | `{ ability, target?, params? }` | Ability activated |
| `AbilityOnCooldownAttempt` | `{ ability }` | Tried to use ability on cooldown |
| `TargetAcquired` | `{ targetId, distance }` | Enemy acquired |
| `TargetSwitched` | `{ from, to }` | Switched target |
| `ItemPicked` | `{ itemId, itemName }` | Picked up item |
| `WeaponEquipped` | `{ weapon, slot? }` | Equipped weapon |
| `DecisionPoint` | `{ entityId, context? }` | AI decision made here |

**Payload notes:**
- All fields in payloads are optional unless otherwise specified
- Keep payloads small (< 1KB typically)
- Use consistent field names across your plugin

### Custom Events

You can emit events not in the canonical list. They're recorded for per-game analytics:

```typescript
sdk.emit({
  type: 'MissionObjectiveCompleted', // custom
  payload: { missionId: 'rescue-the-princess', reward: 500 },
});
```

Custom events aren't indexed by the core AI Engine, but they're useful for game-specific analytics and debugging.

---

## Legal Actions API

### Register a Legal Actions Provider

Before any gameplay that involves AI decisions:

```typescript
sdk.onLegalActionsRequest((entityId: string) => {
  // entityId is the ID of the entity the platform wants to decide for
  return getLegalActionsForEntity(entityId);
});
```

Your function **must**:
1. Return synchronously (no async/await — it's called from the game loop)
2. Return an array of `Action` objects
3. Return an empty array if the entity cannot act (dead, stunned, etc.)

### Action Schema

```typescript
interface Action {
  id: string; // Required, unique within this decision context
  params?: Record<string, unknown>; // Optional action params
  legalUntil?: number; // Optional expiration timestamp
}
```

**Example:**

```typescript
function getLegalActionsForEntity(entityId: string): Action[] {
  const entity = getEntity(entityId);
  if (!entity.isAlive) return []; // Dead entity can't act

  const actions: Action[] = [];

  // Always can move
  actions.push(
    { id: 'move-forward' },
    { id: 'move-backward' },
    { id: 'turn-left' },
    { id: 'turn-right' }
  );

  // Can attack if there's a target and not on cooldown
  if (entity.target && !entity.abilities.attack.onCooldown) {
    actions.push({
      id: 'attack',
      params: { targetId: entity.target.id },
      legalUntil: Date.now() + 100, // Expires in 100ms
    });
  }

  // Can use ability if learned and off cooldown
  if (entity.abilities.fireball.learned && !entity.abilities.fireball.onCooldown) {
    actions.push({
      id: 'ability-fireball',
      legalUntil: Date.now() + 100,
    });
  }

  return actions;
}
```

### Best Practices

1. **Keep the list small** — ideally < 10 actions per entity. If the AI Engine sees 100+ actions, decision time suffers.
2. **Expire stale actions** — use `legalUntil` if an action only makes sense in a narrow time window (e.g., only valid if targeting window is open).
3. **Be deterministic** — calling this function twice for the same entity in the same frame should return the same actions. (The platform may call it multiple times.)
4. **Reference by ID only** — action params should reference entities/items by their ID, not by object reference, since the platform never sees your objects.

---

## Decision API

### Register a Decision Handler

```typescript
sdk.onDecision((entityId: string, action: Action) => {
  // The platform decided that this entity should perform this action
  applyActionToEntity(entityId, action);
});
```

Your handler **must**:
1. Accept an `entityId` and an `Action`
2. Route the action to your game's input/command system
3. Apply it through the **same code path a human player would use**

### Example Implementation

```typescript
sdk.onDecision((entityId: string, action: Action) => {
  const entity = getEntity(entityId);
  if (!entity) return; // Stale reference, ignore

  switch (action.id) {
    case 'move-forward':
      entity.moveForward();
      break;
    case 'move-backward':
      entity.moveBackward();
      break;
    case 'attack':
      const targetId = action.params?.targetId as string;
      entity.attack(getEntity(targetId));
      break;
    case 'ability-fireball':
      entity.castAbility('fireball');
      break;
    default:
      console.warn(`Unknown action: ${action.id}`);
  }
});
```

**Important:** If the action refers to an entity/item that no longer exists (player died, item despawned), handle it gracefully — don't crash, just no-op.

### Timing

The platform may submit decisions at any time after the match starts. Your handler can be called:
- During the game loop (frame update)
- Outside the game loop (if the AI Engine decides asynchronously)
- Multiple times per frame for different entities

Make sure your decision handler is safe to call at any time.

---

## Best Practices

### 1. Keep Events Timely but Not Verbose

**Good:**
```typescript
// Emit once per significant event
sdk.emit({ type: 'PlayerDamaged', payload: { damage: 25, targetHealth: 75 } });
```

**Bad:**
```typescript
// Emitting every frame
requestAnimationFrame(() => {
  sdk.emit({ type: 'PlayerHeartbeat', payload: { frameNumber: 42 } });
});
```

### 2. Use Deterministic Entity IDs

Action params should refer to entities by ID:

```typescript
// ✓ Good — IDs are stable
{ id: 'attack', params: { targetId: 'enemy-42' } }

// ✗ Bad — object references are lost across iframe boundary
{ id: 'attack', params: { target: enemyObject } }
```

### 3. Don't Assume Decision Timing

The AI might decide instantly or after a delay. Don't block the game waiting for a decision:

```typescript
// ✓ Good — request a decision, continue playing
sdk.onLegalActionsRequest((entityId) => {
  return getLegalActions(entityId);
});
// Game loop continues, decision arrives asynchronously

// ✗ Bad — game stops waiting for AI
async function waitForAI() {
  const action = await sdk.requestDecision(entityId); // SDK doesn't have this!
  applyAction(action);
}
```

### 4. Handle Action Expiration

If an action's `legalUntil` timestamp is in the past, the decision is stale. Your handler can ignore it or log a warning:

```typescript
sdk.onDecision((entityId: string, action: Action) => {
  if (action.legalUntil && action.legalUntil < Date.now()) {
    console.warn(`Stale decision for entity ${entityId}, ignoring`);
    return;
  }
  applyActionToEntity(entityId, action);
});
```

### 5. Graceful Degradation When SDK Unavailable

During development, the SDK might not be available (testing without the platform). Handle this:

```typescript
let sdk = null;
try {
  sdk = createGameSDK();
} catch (error) {
  console.warn('SDK unavailable, running in standalone mode');
}

// Later, when emitting events:
if (sdk) {
  sdk.emit({ type: 'PlayerMoved', payload: { x: 10, y: 20 } });
}
```

---

## Testing

### Unit Testing Your Plugin

Use a fake SDK for unit tests:

```typescript
import { GameSDK } from '@adaptive-ai/sdk-client';
import { FakeMessageTransport } from '@adaptive-ai/sdk-client/testing'; // if exposed

const transport = new FakeMessageTransport();
const sdk = new GameSDK(transport);

// Set up handlers
sdk.onLegalActionsRequest((entityId) => {
  return [{ id: 'move' }, { id: 'attack' }];
});

// Simulate a decision
transport.simulateIncoming({
  channel: 'adaptive-ai-sdk/v1',
  kind: 'submitDecision',
  requestId: 'req-1',
  entityId: 'hero',
  action: { id: 'move' },
});

// Assert your handler was called correctly
```

### Integration Testing with the Platform

Once deployed to the platform, test with:
1. A real AI Engine generating decisions
2. Multiple concurrent players
3. Long play sessions to catch memory leaks

Use the Player Dashboard to launch your game and monitor events in the admin panel.

---

## Troubleshooting

### Handshake Fails

**Problem:** "SDK version mismatch"

**Solution:** Your plugin's `@adaptive-ai/sdk-client` version doesn't match the platform's `@adaptive-ai/sdk-host` version. Update both to the same version.

```bash
npm update @adaptive-ai/sdk-client
```

### Events Not Showing Up

**Problem:** You emit an event but don't see it in analytics.

**Checklist:**
- Did the handshake complete? (`sdk.isHandshakeDone()` returns true)
- Is the event type in the canonical list, or is it a custom type?
- Is the event payload valid JSON (no circular references)?
- Are you calling `emit()` during gameplay, not before the match starts?

### Legal Actions Never Requested

**Problem:** `onLegalActionsRequest` is never called.

**Checklist:**
- Did you register the handler? (`sdk.onLegalActionsRequest(...)`)
- Is `supportsAIOpponent` set to `true` in your manifest?
- Did you actually mount an AI-controlled entity in the game? (The platform only requests actions for entities it knows about.)

### Decisions Cause Errors

**Problem:** When `onDecision` is called, the game crashes or acts erratically.

**Checklist:**
- Does your handler check if the entity still exists before applying the action?
- Are you handling unknown action IDs gracefully?
- Is the action's timestamp in the future or past? (Could be stale if you take > 2 seconds to respond.)

### CSP/CORS Issues

**Problem:** SDK messages don't get through, or you see "Cross-Origin-Request-Blocked" errors.

**Solution:** The plugin iframe is sandboxed, but postMessage still works cross-origin without explicit CORS. If you're seeing errors:
- Check that your game HTML loads at the URL specified in the manifest
- Verify that `targetOrigin` matches the platform's origin (or use `'*'` in development)
- Check browser console for CSP violations

---

## Resources

- **SDK API Reference**: [SDK Client API Docs](./platform/sdk/client/README.md)
- **Event Schema**: [Canonical Events](./platform/sdk/protocol/src/types.ts)
- **Example Plugin**: [Dummy Game](./plugins/example-dummy-game/)
- **Manifest Format**: [Manifest Schema](./platform/sdk/protocol/src/types.ts)

---

## Getting Help

- Check the [example plugin](./plugins/example-dummy-game/) for a working reference
- Read the [SDK test files](./platform/sdk/client/src/__tests__/) to see how the SDK is used
- Open an issue on GitHub with details about your problem

Happy plugin building! 🎮

