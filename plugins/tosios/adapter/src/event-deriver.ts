/**
 * TosiosEventDeriver — the Plugin Adapter's core: turns TOSIOS's real,
 * observable state changes into canonical events. Two derivation
 * strategies, used for different signals (see the Phase 10A integration
 * report's "Event mappings" table for the full per-event justification):
 *
 *   1. Message capture (`captureMessage`) — TOSIOS already broadcasts a
 *      `MessageJSON` for match-lifecycle transitions and kills (waiting/
 *      start/stop/joined/killed/won/left/timeout). Zero inference needed;
 *      this is a direct, near-lossless translation.
 *
 *   2. Tick-boundary diffing (`diffTick`) — TOSIOS does NOT broadcast a
 *      message for a non-lethal hit, a pickup, or ordinary movement; those
 *      only ever show up as a public schema field changing between ticks
 *      (`player.lives` decrementing, `player.x`/`y` changing,
 *      `props[i].active` flipping). Comparing this tick's `captureSnapshot`
 *      result against the previous tick's is how this adapter observes
 *      them — the SAME information a Colyseus client's state-sync diff
 *      would show a spectator, never anything a plugin isn't allowed to see.
 *
 * Contains NO AI logic — every function here is a deterministic translation
 * of already-real TOSIOS state into the canonical vocabulary. Nothing is
 * scored, ranked, or decided.
 */
import { TosiosCanonicalEvent, MatchEndOutcome, abilityOnCooldownAttemptEvent, abilityUsedShootEvent, itemPickedEvent, matchEndedEvent, matchStartedEvent, playerDamagedEvent, playerDiedEvent, playerMovedEvent } from './event-mapping';
import { TosiosMessage, TickSnapshot } from './types';
import { Types } from '../vendor-dist/common/src';

/** Below this, a position "change" is floating-point/collision-correction noise, not real movement worth reporting — TOSIOS's own `Maths.round2Digits` rounds to 2 decimal places internally, so anything smaller never reflects a genuine simulated step. */
const MOVEMENT_EPSILON = 0.01;

/** How close a bullet's resting position (or an attacking monster) must be to a player who just took damage to be attributed as the cause — player radius + bullet radius (`Constants.PLAYER_SIZE/2 + Constants.BULLET_SIZE/2` = 16 + 4) plus slack for one tick's travel distance. */
const DAMAGE_ATTRIBUTION_RADIUS = 24;

/**
 * How recently a bullet must have been fired (`Bullet.shotAt`, a real
 * public field) to still be considered the cause of a hit observed THIS
 * tick. Deliberately generous: TOSIOS resolves `updatePlayers()` (which
 * spawns a queued shot's bullet) and `updateBullets()` (which moves and
 * resolves collisions) within the SAME `update()` call — a bullet fired at
 * point-blank range can travel, hit, and deactivate within its very first
 * tick, meaning it may NEVER be observed as `active: true` in any snapshot
 * this adapter takes (see this file's `diffTick` doc comment: snapshots
 * are only taken once per tick, after `update()` returns). Correlating on
 * "recently fired + currently inactive + near the victim" — rather than
 * "was active last tick, is inactive now" — is what makes this robust to
 * that same-tick-resolution case, confirmed against TOSIOS's real
 * behavior in `__tests__/event-deriver.test.ts`.
 */
const BULLET_ATTRIBUTION_WINDOW_MS = 500;

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

export interface DamagedPlayerAttribution {
  sourceType: 'bullet' | 'monster' | 'unknown';
  sourceId?: string;
  distance?: number;
}

/**
 * Correlates a player's lives decreasing this tick with what caused it,
 * using only publicly-observable bullet/monster state (see this file's
 * doc comment). The most-recently-fired inactive bullet resting near the
 * damaged player is attributed as the cause (`sourceId` = the bullet's own
 * `playerId` field — the shooter, exactly what TOSIOS's own game logic
 * already used internally to decide whether the bullet could hurt this
 * player at all). Falls back to the nearest currently-attacking monster,
 * then to 'unknown' if neither correlates — a rare edge case (see README
 * "Known limitations").
 */
export function attributeDamage(playerX: number, playerY: number, current: TickSnapshot): DamagedPlayerAttribution {
  let bestBullet: { playerId: string; d: number; shotAt: number; travelDistance: number } | null = null;
  for (const bullet of current.bullets) {
    if (bullet.active) continue;
    if (current.ts - bullet.shotAt > BULLET_ATTRIBUTION_WINDOW_MS) continue;
    const d = distance(playerX, playerY, bullet.x, bullet.y);
    if (d > DAMAGE_ATTRIBUTION_RADIUS) continue;
    if (bestBullet === null || bullet.shotAt > bestBullet.shotAt) {
      bestBullet = { playerId: bullet.playerId, d, shotAt: bullet.shotAt, travelDistance: distance(bullet.fromX, bullet.fromY, playerX, playerY) };
    }
  }
  if (bestBullet) {
    return { sourceType: 'bullet', sourceId: bestBullet.playerId, distance: bestBullet.travelDistance };
  }

  let closestMonster: { id: string; d: number } | null = null;
  for (const monster of current.monsters) {
    if (!monster.isAlive) continue;
    const d = distance(playerX, playerY, monster.x, monster.y);
    if (d <= DAMAGE_ATTRIBUTION_RADIUS && (closestMonster === null || d < closestMonster.d)) {
      closestMonster = { id: monster.id, d };
    }
  }
  if (closestMonster) {
    return { sourceType: 'monster', distance: closestMonster.d };
  }

  return { sourceType: 'unknown' };
}

export class TosiosEventDeriver {
  private previous: TickSnapshot | null = null;
  private pendingEndReason: { outcome: MatchEndOutcome; winnerName?: string } | null = null;

  /** Feed this every `MessageJSON` TOSIOS's `GameState` broadcasts (its own `onMessage` constructor callback — see adapted-game-room.ts). Needs the current player-name -> id lookup because TOSIOS's own kill message identifies players by display name only, never by id (a real limitation of the upstream message shape, not something this adapter can improve without correlating against currently-known players). */
  captureMessage(message: TosiosMessage, mapName: string, mode: Types.GameMode, maxPlayers: number, playersByName: ReadonlyMap<string, string>): TosiosCanonicalEvent[] {
    switch (message.type) {
      case 'start':
        return [matchStartedEvent(mapName, mode, maxPlayers, message.ts)];

      case 'won':
        this.pendingEndReason = { outcome: 'win', winnerName: message.params.name as string | undefined };
        return [];

      case 'timeout':
        this.pendingEndReason = { outcome: 'timeout' };
        return [];

      case 'stop': {
        const reason = this.pendingEndReason ?? { outcome: 'abandoned' as const };
        this.pendingEndReason = null;
        return [matchEndedEvent(reason.outcome, message.ts, reason.winnerName)];
      }

      case 'killed': {
        const killedName = message.params.killedName as string;
        const killerName = message.params.killerName as string;
        const killedPlayerId = playersByName.get(killedName);
        if (!killedPlayerId) return []; // player already left before we could attribute the message — nothing to report
        const killerId = playersByName.get(killerName); // undefined for a monster kill ("A bat"), correctly omitted
        return [playerDiedEvent(killedPlayerId, killerName, message.ts, killerId)];
      }

      // 'waiting'/'joined'/'left' have no corresponding entry in
      // CANONICAL_EVENT_TYPES (@adaptive-ai/sdk-protocol) — see report.
      default:
        return [];
    }
  }

  /** Call once per tick, right after `state.update()`. Diffs against the previous tick's snapshot (captured via `captureSnapshot`) to derive movement, damage, and pickups TOSIOS never broadcasts as a message. The FIRST call after construction (or after `reset()`) only seeds the baseline and emits nothing, since there is no prior tick to diff against. */
  diffTick(current: TickSnapshot): TosiosCanonicalEvent[] {
    const previous = this.previous;
    this.previous = current;
    if (!previous) return [];

    const events: TosiosCanonicalEvent[] = [];

    for (const [playerId, player] of current.players) {
      const before = previous.players.get(playerId);
      if (!before) continue; // joined this tick — no prior position to diff against

      const dx = player.x - before.x;
      const dy = player.y - before.y;
      if (Math.abs(dx) > MOVEMENT_EPSILON || Math.abs(dy) > MOVEMENT_EPSILON) {
        events.push(playerMovedEvent(playerId, player.x, player.y, dx, dy, current.ts));
      }

      const livesLost = before.lives - player.lives;
      if (livesLost > 0) {
        const attribution = attributeDamage(player.x, player.y, current);
        events.push(
          playerDamagedEvent(
            playerId,
            livesLost,
            attribution.sourceType === 'unknown' ? 'bullet' : attribution.sourceType,
            current.ts,
            attribution.sourceId,
            attribution.distance
          )
        );
      }
    }

    for (let i = 0; i < current.props.length; i++) {
      const before = previous.props[i];
      const after = current.props[i];
      if (before?.active && !after.active) {
        // Attribute the pickup to whichever player is standing on the prop this tick — TOSIOS resolves the pickup synchronously inside the same movement collision check, so the picking-up player is always co-located with the prop the instant it deactivates.
        for (const [playerId, player] of current.players) {
          if (distance(player.x, player.y, after.x, after.y) <= DAMAGE_ATTRIBUTION_RADIUS) {
            events.push(itemPickedEvent(playerId, after.type, i, current.ts));
            break;
          }
        }
      }
    }

    return events;
  }

  /** Call from the adapter's own re-registered `onMessage('*', ...)` handler (adapted-game-room.ts), for a 'shoot' action, BEFORE forwarding to `state.playerPushAction`. Independently re-checks the exact rate-limit condition TOSIOS's own private `GameState.playerShoot` checks internally (`Constants.BULLET_RATE`) — never mutates state, purely observes. */
  observeShootAttempt(playerId: string, lastShootAt: number | undefined, bulletRateMs: number, angle: number, ts: number): TosiosCanonicalEvent {
    if (lastShootAt !== undefined) {
      const elapsed = ts - lastShootAt;
      if (elapsed < bulletRateMs) {
        return abilityOnCooldownAttemptEvent(playerId, bulletRateMs - elapsed, ts);
      }
      return abilityUsedShootEvent(playerId, angle, elapsed, ts);
    }
    return abilityUsedShootEvent(playerId, angle, Number.POSITIVE_INFINITY, ts);
  }

  /** Test/ops helper: clears the diffing baseline (e.g. between independent test scenarios sharing one deriver instance). */
  reset(): void {
    this.previous = null;
    this.pendingEndReason = null;
  }
}
