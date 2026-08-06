/**
 * Legal action space for a TOSIOS player, and the translation back down to
 * TOSIOS's own `ActionJSON` — the Decision Adapter half of Phase 10B's
 * "Strategy Planner -> Decision Engine -> Plugin SDK -> Legal Actions ->
 * TOSIOS" chain (per the mission's PHASE 10D). This file declares WHAT is
 * legal; decision-adapter.ts is what actually calls
 * `state.playerPushAction(...)` — the exact same public entry point a human
 * client's input already goes through (see decision-adapter.ts's doc
 * comment for why that's the whole fairness guarantee).
 *
 * TOSIOS's real input surface is CONTINUOUS (an arbitrary 2D move vector,
 * an arbitrary rotation angle) — not a small discrete menu. Utility AI
 * (the Decision Engine) scores a finite candidate set, so this file's job
 * is exactly the "Decision Adapter" concept from
 * PLATFORM_REDESIGN_PROPOSAL.md §(cross-game intelligence): discretizing a
 * continuous action space into a small, tagged, genre-agnostic-labeled set
 * the existing Decision Engine considerations (`planAdherence`,
 * `punishOpening`, `safety`, ...) already know how to score via
 * `action.params.tags` — see @adaptive-ai/decision-engine's
 * `considerations/tags.ts`/`plan-adherence.ts` for the exact tag vocabulary
 * this file targets.
 */
import { Action } from '@adaptive-ai/sdk-protocol';

export type CompassDirection = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

/** Unit vectors for the 8 compass directions — TOSIOS's own `move()` normalizes the vector internally (`Maths.normalize2D`), so only direction matters, not magnitude. */
export const COMPASS_VECTORS: Record<CompassDirection, { x: number; y: number }> = {
  N: { x: 0, y: -1 },
  NE: { x: 1, y: -1 },
  E: { x: 1, y: 0 },
  SE: { x: 1, y: 1 },
  S: { x: 0, y: 1 },
  SW: { x: -1, y: 1 },
  W: { x: -1, y: 0 },
  NW: { x: -1, y: -1 },
};

export function normalize(x: number, y: number): { x: number; y: number } {
  const magnitude = Math.sqrt(x * x + y * y);
  if (magnitude === 0) return { x: 0, y: 0 };
  return { x: x / magnitude, y: y / magnitude };
}

export function angleTo(fromX: number, fromY: number, toX: number, toY: number): number {
  return Math.atan2(toY - fromY, toX - fromX);
}

/** action.id -> what the Decision Adapter needs to reconstruct the exact TOSIOS command. Kept out of `Action.params` itself (which is untyped `Record<string, unknown>`, read by the Decision Engine's considerations, not by us) — decision-adapter.ts re-derives this deterministically from the id string alone, so there is exactly one source of truth for "what does this id mean," this file. */
export function buildMoveAction(direction: CompassDirection, legalUntilMs: number): Action {
  return {
    id: `move:${direction}`,
    params: { tags: ['move', 'reposition', 'position'] },
    legalUntil: legalUntilMs,
  };
}

export function buildHoldAction(legalUntilMs: number): Action {
  return { id: 'hold', params: { tags: ['wait', 'observe'] }, legalUntil: legalUntilMs };
}

export function buildAdvanceOnOpponentAction(legalUntilMs: number): Action {
  return { id: 'move:towardNearestOpponent', params: { tags: ['offensive', 'attack', 'pressure'] }, legalUntil: legalUntilMs };
}

export function buildRetreatFromOpponentAction(legalUntilMs: number): Action {
  return { id: 'move:awayFromNearestOpponent', params: { tags: ['defensive', 'retreat'] }, legalUntil: legalUntilMs };
}

export function buildShootAction(legalUntilMs: number): Action {
  return { id: 'shoot:nearestOpponent', params: { tags: ['offensive', 'attack', 'pressure'] }, legalUntil: legalUntilMs };
}
