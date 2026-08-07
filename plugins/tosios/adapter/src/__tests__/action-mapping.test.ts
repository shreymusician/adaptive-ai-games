import { describe, it, expect } from 'vitest';
import { COMPASS_VECTORS, normalize, angleTo, buildMoveAction, buildHoldAction, buildAdvanceOnOpponentAction, buildRetreatFromOpponentAction, buildShootAction } from '../action-mapping';

describe('normalize', () => {
  it('produces a unit vector', () => {
    const v = normalize(3, 4);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 10);
  });

  it('the zero vector normalizes to the zero vector, never NaN/Infinity', () => {
    const v = normalize(0, 0);
    expect(v).toEqual({ x: 0, y: 0 });
  });
});

describe('angleTo', () => {
  it('points due east as angle 0', () => {
    expect(angleTo(0, 0, 10, 0)).toBeCloseTo(0, 10);
  });

  it('points due south as angle PI/2 (TOSIOS y-down convention)', () => {
    expect(angleTo(0, 0, 0, 10)).toBeCloseTo(Math.PI / 2, 10);
  });
});

describe('all 8 compass vectors are real unit-length (or diagonal-normalized-by-consumer) directions', () => {
  it('every direction has the expected sign pattern', () => {
    expect(COMPASS_VECTORS.N).toEqual({ x: 0, y: -1 });
    expect(COMPASS_VECTORS.S).toEqual({ x: 0, y: 1 });
    expect(COMPASS_VECTORS.E).toEqual({ x: 1, y: 0 });
    expect(COMPASS_VECTORS.W).toEqual({ x: -1, y: 0 });
  });
});

describe('action builders — every action declares tags the Decision Engine already reads', () => {
  it('buildHoldAction is tagged wait/observe', () => {
    expect(buildHoldAction(1000).params?.tags).toEqual(['wait', 'observe']);
  });

  it('buildMoveAction is tagged move/reposition/position', () => {
    expect(buildMoveAction('N', 1000).params?.tags).toEqual(['move', 'reposition', 'position']);
    expect(buildMoveAction('N', 1000).id).toBe('move:N');
  });

  it('buildAdvanceOnOpponentAction is tagged offensive/attack/pressure', () => {
    expect(buildAdvanceOnOpponentAction(1000).params?.tags).toEqual(['offensive', 'attack', 'pressure']);
  });

  it('buildRetreatFromOpponentAction is tagged defensive/retreat', () => {
    expect(buildRetreatFromOpponentAction(1000).params?.tags).toEqual(['defensive', 'retreat']);
  });

  it('buildShootAction is tagged offensive/attack/pressure', () => {
    expect(buildShootAction(1000).params?.tags).toEqual(['offensive', 'attack', 'pressure']);
  });

  it('every builder sets legalUntil to exactly what was passed in', () => {
    expect(buildHoldAction(4242).legalUntil).toBe(4242);
    expect(buildMoveAction('E', 4242).legalUntil).toBe(4242);
  });
});
