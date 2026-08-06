/**
 * Decision Adapter — `getLegalActions`/`applyDecision`, wired to the
 * Plugin SDK's `LegalActionsProvider`/`DecisionHandler` shapes
 * (`@adaptive-ai/sdk-client`'s `GameSDK.onLegalActionsRequest`/`onDecision`).
 *
 * The whole "no direct state mutation, no cheating" guarantee (mission
 * PHASE 10D) is structural here, not a promise: `applyDecision` calls
 * EXACTLY ONE TOSIOS method — the real, unmodified, public
 * `GameState.playerPushAction(...)` — the SAME method
 * `GameRoom`'s `onMessage('*', ...)` handler already calls for a human
 * client's `move`/`rotate`/`shoot` input (see
 * `../upstream/packages/server/src/rooms/GameRoom.ts`). There is no second
 * code path; an AI-chosen action and a human-chosen action become
 * indistinguishable the instant they reach `playerPushAction`.
 */
import { Action } from '@adaptive-ai/sdk-protocol';
import { TosiosGameState } from './types';
import { CompassDirection, COMPASS_VECTORS, angleTo, buildAdvanceOnOpponentAction, buildHoldAction, buildMoveAction, buildRetreatFromOpponentAction, buildShootAction, normalize } from './action-mapping';

const COMPASS_DIRECTIONS: CompassDirection[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** How far ahead a returned Action's `legalUntil` reaches — one TOSIOS-side reconciliation window (see report "Tick/update loop"), so the Decision Engine never acts on an action whose legality has already been superseded by a newer tick. */
const LEGAL_ACTION_WINDOW_MS = 100;

function findNearestOpponent(state: TosiosGameState, selfId: string): { playerId: string; x: number; y: number } | null {
  const self = state.players.get(selfId);
  if (!self) return null;

  let nearest: { playerId: string; x: number; y: number; d: number } | null = null;
  state.players.forEach((player, playerId) => {
    if (playerId === selfId || !player.isAlive) return;
    if (self.team && player.team === self.team) return; // team deathmatch: never target a teammate
    const d = Math.hypot(player.x - self.x, player.y - self.y);
    if (nearest === null || d < nearest.d) {
      nearest = { playerId, x: player.x, y: player.y, d };
    }
  });
  return nearest;
}

/**
 * Every currently-legal action for `playerId`, per the real, current
 * `GameState` — never a static/precomputed list. A dead player, or one
 * not present in this room at all, has no legal actions (an empty legal
 * -action list is a real, valid outcome the Decision Engine's own
 * `NoLegalActionsError` already handles — see decision-engine's errors.ts
 * — never papered over here).
 */
export function getLegalActions(state: TosiosGameState, playerId: string, now: number, bulletRateMs: number): Action[] {
  const player = state.players.get(playerId);
  if (!player || !player.isAlive || state.game.state !== 'game') return [];

  const legalUntil = now + LEGAL_ACTION_WINDOW_MS;
  const actions: Action[] = [buildHoldAction(legalUntil)];

  for (const direction of COMPASS_DIRECTIONS) {
    actions.push(buildMoveAction(direction, legalUntil));
  }

  const opponent = findNearestOpponent(state, playerId);
  if (opponent) {
    actions.push(buildAdvanceOnOpponentAction(legalUntil));
    actions.push(buildRetreatFromOpponentAction(legalUntil));

    const onCooldown = player.lastShootAt !== undefined && now - player.lastShootAt < bulletRateMs;
    if (!onCooldown) {
      actions.push(buildShootAction(legalUntil));
    }
  }

  return actions;
}

export interface AppliedAction {
  type: 'move' | 'rotate' | 'shoot';
  value: Record<string, number>;
}

/**
 * Translates a Decision Engine `Action` (one of the ids `getLegalActions`
 * produced, e.g. `move:N` or `shoot:nearestOpponent`) into the sequence of
 * real TOSIOS `playerPushAction` calls that ACTUALLY realize it — a rotate
 * (to face the intended direction/target) followed by the move or shoot
 * itself, exactly mirroring the real client's own `rotate()` -> `move()`/
 * `shoot()` call order (see `../upstream/packages/client/src/game/Game.ts`).
 * Returns the applied commands for observability/testing; never returns
 * anything the caller could use to bypass `playerPushAction`.
 */
export function applyDecision(state: TosiosGameState, playerId: string, action: Action, now: number): AppliedAction[] {
  const player = state.players.get(playerId);
  if (!player || !player.isAlive) return [];

  const applied: AppliedAction[] = [];
  const push = (type: AppliedAction['type'], value: Record<string, number>): void => {
    state.playerPushAction({ playerId, ts: now, type, value });
    applied.push({ type, value });
  };

  if (action.id === 'hold') {
    return applied; // deliberately no command at all — "do nothing" is legal and real, not simulated by a zero-vector move
  }

  if (action.id.startsWith('move:')) {
    const target = action.id.slice('move:'.length);
    let vector: { x: number; y: number };
    let rotation: number | null = null;

    if (target === 'towardNearestOpponent' || target === 'awayFromNearestOpponent') {
      const opponent = findNearestOpponent(state, playerId);
      if (!opponent) return applied; // opponent left/died between getLegalActions and submitDecision — no-op, never fabricate a target
      const towards = normalize(opponent.x - player.x, opponent.y - player.y);
      vector = target === 'towardNearestOpponent' ? towards : { x: -towards.x, y: -towards.y };
      rotation = angleTo(player.x, player.y, opponent.x, opponent.y);
    } else if (target in COMPASS_VECTORS) {
      vector = COMPASS_VECTORS[target as keyof typeof COMPASS_VECTORS];
      rotation = Math.atan2(vector.y, vector.x);
    } else {
      return applied; // unknown action id — never guess, never fall through to a default movement
    }

    if (rotation !== null) push('rotate', { rotation });
    push('move', { x: vector.x, y: vector.y });
    return applied;
  }

  if (action.id === 'shoot:nearestOpponent') {
    const opponent = findNearestOpponent(state, playerId);
    if (!opponent) return applied;
    const angle = angleTo(player.x, player.y, opponent.x, opponent.y);
    push('rotate', { rotation: angle });
    push('shoot', { angle });
    return applied;
  }

  return applied; // unrecognized action id — never invents a fallback action (whitepaper-consistent: "never invent an action")
}
