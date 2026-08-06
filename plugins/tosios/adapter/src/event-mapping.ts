/**
 * Pure TOSIOS-signal -> canonical-event mapping functions. Every function
 * here takes already-observed, already-real values (never estimates,
 * never invents a field) and returns a `TosiosCanonicalEvent` — this
 * adapter's own event shape, `EmitEventInput` plus an explicit `playerId`
 * (see this package's README "Known architectural finding: per-player
 * attribution" for why `EmitEventInput` alone — which the SDK protocol
 * deliberately never carries a playerId on — isn't sufficient for a
 * single-room, many-players-per-match server-authoritative plugin like
 * TOSIOS).
 *
 * Every mapping decision below is justified against either (a) the real,
 * already-implemented `CANONICAL_EVENT_TYPES` in `@adaptive-ai/sdk-protocol`,
 * or (b) the real payload fields already read by a shipped Pattern
 * Recognition detector or Player Modeling analyzer (grepped from
 * `platform/ai-engine/{pattern-recognition,player-modeling}/src` and from
 * `platform/event-pipeline/validation/plugins.ts`'s validation fixtures) —
 * never invented ad hoc. See the Phase 10A integration report's "Event
 * mappings" table for the full justification per event type.
 */
import { CanonicalEventType, EmitEventInput } from '@adaptive-ai/sdk-protocol';
import { Types } from '../vendor-dist/common/src';

export interface TosiosCanonicalEvent extends EmitEventInput {
  type: CanonicalEventType;
  /** Which TOSIOS player (Colyseus sessionId) this event is about — see doc comment above. */
  playerId: string;
}

function event(type: CanonicalEventType, playerId: string, payload: Record<string, unknown>, ts: number): TosiosCanonicalEvent {
  return { type, playerId, payload, ts };
}

// ---------------------------------------------------------------------------
// Match lifecycle — from TOSIOS's own broadcast MessageJSON stream
// (captured via handleMessage, see event-deriver.ts). `playerId` on these
// two is the empty string: they describe the MATCH/ROOM, not one player —
// the future host-wiring layer is expected to fan these out room-wide
// rather than attribute them to a single player (see README).
// ---------------------------------------------------------------------------

export function matchStartedEvent(mapName: string, mode: Types.GameMode, maxPlayers: number, ts: number): TosiosCanonicalEvent {
  return event('MatchStarted', '', { map: mapName, mode, maxPlayers }, ts);
}

export type MatchEndOutcome = 'win' | 'timeout' | 'abandoned';

export function matchEndedEvent(outcome: MatchEndOutcome, ts: number, winnerName?: string): TosiosCanonicalEvent {
  return event('MatchEnded', '', { outcome, ...(winnerName !== undefined ? { winnerName } : {}) }, ts);
}

// ---------------------------------------------------------------------------
// Per-player events — derived either from a captured input message, or from
// tick-boundary state diffing (see event-deriver.ts for which is which).
// ---------------------------------------------------------------------------

export function playerMovedEvent(playerId: string, x: number, y: number, dx: number, dy: number, ts: number): TosiosCanonicalEvent {
  return event('PlayerMoved', playerId, { x, y, dx, dy }, ts);
}

export type DamageSourceType = 'bullet' | 'monster';

export function playerDamagedEvent(playerId: string, amount: number, sourceType: DamageSourceType, ts: number, sourceId?: string, distance?: number): TosiosCanonicalEvent {
  return event(
    'PlayerDamaged',
    playerId,
    { amount, sourceType, ...(sourceId !== undefined ? { sourceId } : {}), ...(distance !== undefined ? { distance } : {}) },
    ts
  );
}

export function playerDiedEvent(playerId: string, killerName: string, ts: number, killerId?: string, distance?: number): TosiosCanonicalEvent {
  return event('PlayerDied', playerId, { killerName, ...(killerId !== undefined ? { killerId } : {}), ...(distance !== undefined ? { distance } : {}) }, ts);
}

/** TOSIOS's one weapon/action (`shoot`) mapped as an "ability" with a cooldown — `hit` is deliberately NEVER included here (see README "Known limitations": bullet-to-shot correlation is not yet implemented, so shot outcome can't be truthfully attached at fire time). */
export function abilityUsedShootEvent(playerId: string, angle: number, timeSinceCooldownReadyMs: number, ts: number): TosiosCanonicalEvent {
  return event('AbilityUsed', playerId, { weaponAction: 'shoot', weaponId: 'staff', offensive: true, angle, timeSinceCooldownReadyMs }, ts);
}

export function abilityOnCooldownAttemptEvent(playerId: string, remainingCooldownMs: number, ts: number): TosiosCanonicalEvent {
  return event('AbilityOnCooldownAttempt', playerId, { weaponAction: 'shoot', weaponId: 'staff', remainingCooldownMs }, ts);
}

export function itemPickedEvent(playerId: string, itemType: string, propIndex: number, ts: number): TosiosCanonicalEvent {
  return event('ItemPicked', playerId, { itemType, propIndex }, ts);
}
