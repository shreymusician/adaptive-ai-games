/**
 * Adapter-internal types. Nothing here is AI logic — this file exists only
 * to give the event-derivation/decision-mapping code below precise shapes
 * to work with, mirroring (never redefining the behavior of) the real
 * vendored TOSIOS types it reads.
 */
import { GameState } from '../vendor-dist/server/src/states/GameState';
import { Models, Types } from '../vendor-dist/common/src';

export type TosiosGameState = GameState;
export type TosiosMessage = Models.MessageJSON;
export type TosiosActionType = Models.ActionType;

/** One player's observable-from-outside state, captured once per tick for diffing. Every field here is a real, PUBLIC field already on TOSIOS's own `Player` schema — nothing is inferred or estimated. */
export interface PlayerSnapshot {
  playerId: string;
  name: string;
  x: number;
  y: number;
  lives: number;
  isAlive: boolean;
  kills: number;
  team: Types.Teams;
  lastShootAt: number | undefined;
}

/** One prop's observable state, captured once per tick. */
export interface PropSnapshot {
  index: number;
  type: string;
  active: boolean;
  x: number;
  y: number;
}

/** One bullet's observable state, captured once per tick — used only to correlate a player's lives decreasing with WHICH bullet (and therefore which shooter) caused it, since TOSIOS's own hit resolution never broadcasts that attribution itself (see event-deriver.ts's damage-source-attribution doc comment). `playerId`/`fromX`/`fromY` are real PUBLIC fields already on TOSIOS's own `Bullet` schema. */
export interface BulletSnapshot {
  index: number;
  active: boolean;
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  playerId: string;
  shotAt: number;
}

/** One monster's observable state, captured once per tick — used only for damage-source attribution (a lives decrease not explained by a bullet is attributed to the nearest currently-attacking monster). */
export interface MonsterSnapshot {
  id: string;
  x: number;
  y: number;
  isAlive: boolean;
}

/** A full tick's worth of diffable state — everything the deriver compares against the PREVIOUS tick's snapshot to produce canonical events for state changes TOSIOS itself never broadcasts as a message (e.g. a non-lethal hit only ever shows up as `player.lives` decrementing). */
export interface TickSnapshot {
  ts: number;
  players: Map<string, PlayerSnapshot>;
  props: PropSnapshot[];
  bullets: BulletSnapshot[];
  monsters: MonsterSnapshot[];
  gameState: Types.GameState;
}
