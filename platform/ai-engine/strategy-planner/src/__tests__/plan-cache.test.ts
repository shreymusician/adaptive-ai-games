import { describe, it, expect } from 'vitest';
import { checkCacheValidity, eligibleInterruptGoalIds, findInterruptingGoal, fingerprintWorldState, PlanCache } from '../plan-cache';
import { buildRegistry } from './fixtures';
import { GoalCandidateTrace, StrategicIntent } from '../types';

function makeIntent(goalId: string): StrategicIntent {
  return {
    intentId: 'i1',
    matchId: 'm1',
    playerId: 'p1',
    gameId: 'g1',
    goalId,
    goalDisplayName: goalId,
    category: 'defense',
    confidence: 0.5,
    plannedSequence: [],
    personality: 'aggressive',
    awarenessBudget: 0.9,
    awarenessUsed: { tier: 'expert', budget: 0.9, usedRecentObservations: true, usedSemanticProfile: false, usedPatterns: false, usedEpisodicMemory: false, semanticDimensionsRead: [], patternIdsRead: [], episodeIdsRead: [] },
    planningMetadata: { plannerVersion: 1, searchDepthUsed: 1, maxSearchDepth: 3, nodesExpanded: 14, nodeBudget: 60, beamWidth: 3, cacheHit: false, replanned: true, interruptedGoalId: null, candidateCount: 14, planningDurationMs: 1 },
    planningTrace: { worldState: {}, candidates: [], planSequence: [], rejectedEligible: [] },
    generatedAt: 1000,
    validUntil: 16000,
  };
}

describe('fingerprintWorldState', () => {
  it('is identical for the same facts regardless of key insertion order', () => {
    const a = fingerprintWorldState({ x: true, y: 1 });
    const b = fingerprintWorldState({ y: 1, x: true });
    expect(a).toBe(b);
  });

  it('differs when a fact value changes', () => {
    const a = fingerprintWorldState({ x: true });
    const b = fingerprintWorldState({ x: false });
    expect(a).not.toBe(b);
  });
});

describe('checkCacheValidity', () => {
  const entry = { intent: makeIntent('pressurePlayer'), worldStateFingerprint: 'fp-1', awarenessBudget: 0.9, personality: 'aggressive' as const, createdAt: 1000, eligibleInterruptGoalIds: [] };

  it('is valid when nothing has changed and TTL has not elapsed', () => {
    const result = checkCacheValidity(entry, 5000, 'fp-1', 0.9, 'aggressive', 15000);
    expect(result).toEqual({ valid: true, reason: 'valid' });
  });

  it('is invalid once the TTL has elapsed', () => {
    const result = checkCacheValidity(entry, 20000, 'fp-1', 0.9, 'aggressive', 15000);
    expect(result).toEqual({ valid: false, reason: 'ttl_expired' });
  });

  it('is invalid when the world state fingerprint changed', () => {
    const result = checkCacheValidity(entry, 5000, 'fp-2', 0.9, 'aggressive', 15000);
    expect(result).toEqual({ valid: false, reason: 'world_state_changed' });
  });

  it('is invalid when the awareness budget changed', () => {
    const result = checkCacheValidity(entry, 5000, 'fp-1', 0.2, 'aggressive', 15000);
    expect(result).toEqual({ valid: false, reason: 'awareness_budget_changed' });
  });

  it('is invalid when the personality changed', () => {
    const result = checkCacheValidity(entry, 5000, 'fp-1', 0.9, 'defensive', 15000);
    expect(result).toEqual({ valid: false, reason: 'personality_changed' });
  });
});

describe('eligibleInterruptGoalIds', () => {
  const registry = buildRegistry();

  it('returns only eligible goals with a positive interruptPriority', () => {
    const candidates: GoalCandidateTrace[] = [
      { goalId: 'controlSpace', utility: 0.5, cost: 0.3, personalityWeight: 1, score: 0.2, preconditionsMet: true, reasoning: {} }, // priority 0
      { goalId: 'retreat', utility: 0.9, cost: 0.15, personalityWeight: 1, score: 0.75, preconditionsMet: true, reasoning: {} }, // priority 10
      { goalId: 'protectObjective', utility: 0, cost: 1, personalityWeight: 1, score: -1, preconditionsMet: false, reasoning: {} }, // ineligible
    ];
    expect(eligibleInterruptGoalIds(registry, candidates)).toEqual(['retreat']);
  });
});

describe('findInterruptingGoal — state-transition semantics', () => {
  const registry = buildRegistry();

  it('returns null when no eligible goal has a positive interruptPriority', () => {
    const candidates: GoalCandidateTrace[] = [{ goalId: 'controlSpace', utility: 0.5, cost: 0.3, personalityWeight: 1, score: 0.2, preconditionsMet: true, reasoning: {} }];
    expect(findInterruptingGoal(registry, candidates, new Set())).toBeNull();
  });

  it('returns null when the interrupt-capable goal was ALREADY eligible last time (no new transition — this is what makes incremental replanning possible)', () => {
    const candidates: GoalCandidateTrace[] = [{ goalId: 'retreat', utility: 0.9, cost: 0.15, personalityWeight: 1, score: 0.75, preconditionsMet: true, reasoning: {} }];
    expect(findInterruptingGoal(registry, candidates, new Set(['retreat']))).toBeNull();
  });

  it('returns the interrupting goal id when it newly becomes eligible compared to last time', () => {
    const candidates: GoalCandidateTrace[] = [
      { goalId: 'pressurePlayer', utility: 0.6, cost: 0.35, personalityWeight: 1, score: 0.25, preconditionsMet: true, reasoning: {} },
      { goalId: 'retreat', utility: 0.9, cost: 0.15, personalityWeight: 1, score: 0.75, preconditionsMet: true, reasoning: {} },
    ];
    expect(findInterruptingGoal(registry, candidates, new Set())).toBe('retreat');
  });

  it('ignores an ineligible interrupt-capable goal (preconditionsMet: false)', () => {
    const candidates: GoalCandidateTrace[] = [
      { goalId: 'pressurePlayer', utility: 0.6, cost: 0.35, personalityWeight: 1, score: 0.25, preconditionsMet: true, reasoning: {} },
      { goalId: 'retreat', utility: 0, cost: 1, personalityWeight: 1, score: -1, preconditionsMet: false, reasoning: {} },
    ];
    expect(findInterruptingGoal(registry, candidates, new Set())).toBeNull();
  });

  it('picks the HIGHEST interruptPriority among newly-eligible interrupt-capable goals', () => {
    const candidates: GoalCandidateTrace[] = [
      { goalId: 'protectObjective', utility: 0.9, cost: 0.3, personalityWeight: 1, score: 0.6, preconditionsMet: true, reasoning: {} }, // priority 5
      { goalId: 'retreat', utility: 0.9, cost: 0.15, personalityWeight: 1, score: 0.75, preconditionsMet: true, reasoning: {} }, // priority 10
    ];
    expect(findInterruptingGoal(registry, candidates, new Set())).toBe('retreat');
  });

  it('a goal that stays eligible across calls never re-triggers, but a DIFFERENT interrupt goal newly appearing still does', () => {
    const candidates: GoalCandidateTrace[] = [
      { goalId: 'protectObjective', utility: 0.9, cost: 0.3, personalityWeight: 1, score: 0.6, preconditionsMet: true, reasoning: {} },
      { goalId: 'retreat', utility: 0.9, cost: 0.15, personalityWeight: 1, score: 0.75, preconditionsMet: true, reasoning: {} },
    ];
    // protectObjective was already known eligible; retreat is new.
    expect(findInterruptingGoal(registry, candidates, new Set(['protectObjective']))).toBe('retreat');
  });
});

describe('PlanCache', () => {
  it('stores, retrieves, and invalidates per-match entries independently', () => {
    const cache = new PlanCache();
    const entryA = { intent: makeIntent('a'), worldStateFingerprint: 'fp', awarenessBudget: 0.9, personality: 'aggressive' as const, createdAt: 1, eligibleInterruptGoalIds: [] };
    const entryB = { intent: makeIntent('b'), worldStateFingerprint: 'fp', awarenessBudget: 0.9, personality: 'aggressive' as const, createdAt: 1, eligibleInterruptGoalIds: [] };

    cache.set('match-a', entryA);
    cache.set('match-b', entryB);
    expect(cache.size()).toBe(2);
    expect(cache.get('match-a')!.intent.goalId).toBe('a');

    expect(cache.invalidate('match-a')).toBe(true);
    expect(cache.get('match-a')).toBeUndefined();
    expect(cache.get('match-b')).toBeDefined();

    cache.clear();
    expect(cache.size()).toBe(0);
  });
});
