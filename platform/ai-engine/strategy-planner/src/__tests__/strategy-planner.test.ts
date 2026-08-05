import { describe, it, expect } from 'vitest';
import { buildPlanner, baseInputs } from './fixtures';
import { StrategyPlanner } from '../strategy-planner';
import { GoalRegistry } from '../registry';
import { loadStrategyPlannerConfig } from '../config';
import { registerAllGoals } from '../goals';

describe('StrategyPlanner.plan — basic contract', () => {
  it('never selects a gameplay action or references legal actions — output is StrategicIntent only', () => {
    const planner = buildPlanner();
    const intent = planner.plan(baseInputs());
    expect(intent).not.toHaveProperty('action');
    expect(intent).not.toHaveProperty('legalActions');
    expect(typeof intent.goalId).toBe('string');
    expect(intent.confidence).toBeGreaterThanOrEqual(0);
    expect(intent.confidence).toBeLessThanOrEqual(1);
  });

  it('always resolves to SOME goal, even from a totally empty world state (RegroupGoal fallback)', () => {
    const planner = buildPlanner();
    const intent = planner.plan(baseInputs({ publicGameState: {} }));
    expect(intent.goalId).toBeTruthy();
  });

  it('reports full planning metadata', () => {
    const planner = buildPlanner();
    const intent = planner.plan(baseInputs());
    expect(intent.planningMetadata.plannerVersion).toBe(1);
    expect(intent.planningMetadata.nodesExpanded).toBeGreaterThan(0);
    expect(intent.planningMetadata.candidateCount).toBeGreaterThan(0);
  });

  it('the planning trace includes the world state, every candidate, and the chosen plan sequence', () => {
    const planner = buildPlanner();
    const intent = planner.plan(baseInputs({ publicGameState: { spaceContested: 0.7, openingAvailable: true } }));
    expect(intent.planningTrace.worldState).toBeDefined();
    expect(intent.planningTrace.candidates.length).toBeGreaterThan(0);
    expect(intent.planningTrace.planSequence.length).toBeGreaterThan(0);
    expect(intent.planningTrace.planSequence[0].goalId).toBe(intent.goalId);
  });
});

describe('StrategyPlanner.plan — deterministic replay', () => {
  it('the exact same PlanningInputs (and clock) produce an identical StrategicIntent decision, replayed from a fresh planner', () => {
    const inputs = baseInputs({
      publicGameState: { spaceContested: 0.6, openingAvailable: true, selfHealth: 0.8 },
      semanticProfile: [{ dimension: 'aggression', gameId: 'game-1', value: 0.7, confidence: 0.6, samples: 12 }],
      patterns: [{ patternId: 'dodgeDirection:left', detectorId: 'dodgeDirection', patternKey: 'left', category: 'movement', state: 'confirmed', confidence: 0.6, description: 'x' }],
    });
    const now = 1_700_000_000_000;

    const firstPlanner = buildPlanner();
    const first = firstPlanner.plan(inputs, now);

    const secondPlanner = buildPlanner();
    const second = secondPlanner.plan(inputs, now);

    expect(second.goalId).toBe(first.goalId);
    expect(second.plannedSequence).toEqual(first.plannedSequence);
    expect(second.confidence).toBe(first.confidence);
    expect(second.planningTrace.planSequence.map((s) => s.goalId)).toEqual(first.planningTrace.planSequence.map((s) => s.goalId));
    // intentId is expected to differ (each call mints its own id) — everything ELSE about the decision must match exactly.
  });
});

describe('StrategyPlanner.plan — plan caching / incremental replanning', () => {
  it('a second call with unchanged inputs is a cache hit and returns the same decision', () => {
    const planner = buildPlanner();
    const inputs = baseInputs({ publicGameState: { spaceContested: 0.6, openingAvailable: true } });
    const first = planner.plan(inputs, 1000);
    const second = planner.plan(inputs, 1500);

    expect(second.planningMetadata.cacheHit).toBe(true);
    expect(second.planningMetadata.replanned).toBe(false);
    expect(second.goalId).toBe(first.goalId);
    expect(second.intentId).toBe(first.intentId);
  });

  it('the first call for a match is never a cache hit', () => {
    const planner = buildPlanner();
    const intent = planner.plan(baseInputs());
    expect(intent.planningMetadata.cacheHit).toBe(false);
    expect(intent.planningMetadata.replanned).toBe(true);
  });

  it('a changed world state triggers a full replan, not a cache hit', () => {
    const planner = buildPlanner();
    const first = planner.plan(baseInputs({ publicGameState: { spaceContested: 0.6 } }), 1000);
    const second = planner.plan(baseInputs({ publicGameState: { objectiveThreatened: true } }), 1500);
    expect(second.planningMetadata.cacheHit).toBe(false);
    expect(second.planningMetadata.replanned).toBe(true);
  });

  it('a changed awareness budget triggers a full replan even with identical game state', () => {
    const planner = buildPlanner();
    const state = { publicGameState: { spaceContested: 0.6 } };
    const first = planner.plan(baseInputs({ ...state, awarenessBudget: 0.9 }), 1000);
    const second = planner.plan(baseInputs({ ...state, awarenessBudget: 0.1 }), 1500);
    expect(second.planningMetadata.cacheHit).toBe(false);
  });

  it('a changed personality triggers a full replan even with identical game state', () => {
    const planner = buildPlanner();
    const state = { publicGameState: { spaceContested: 0.6 } };
    planner.plan(baseInputs({ ...state, personality: 'aggressive' }), 1000);
    const second = planner.plan(baseInputs({ ...state, personality: 'defensive' }), 1500);
    expect(second.planningMetadata.cacheHit).toBe(false);
  });

  it('the plan TTL forces a replan even with a completely unchanged world state', () => {
    const config = loadStrategyPlannerConfig({ goap: { maxSearchDepth: 3, nodeBudget: 60, beamWidth: 3, discountFactor: 0.85, planTtlMs: 1000 } });
    const registry = new GoalRegistry();
    registerAllGoals(registry);
    const planner = new StrategyPlanner({ registry, config });

    const inputs = baseInputs({ publicGameState: { spaceContested: 0.6 } });
    planner.plan(inputs, 1000);
    const afterTtl = planner.plan(inputs, 5000);
    expect(afterTtl.planningMetadata.cacheHit).toBe(false);
  });

  it('invalidate() forces the next call to replan regardless of otherwise-unchanged inputs', () => {
    const planner = buildPlanner();
    const inputs = baseInputs({ publicGameState: { spaceContested: 0.6 } });
    planner.plan(inputs, 1000);
    planner.invalidate('match-1');
    const afterInvalidate = planner.plan(inputs, 1001);
    expect(afterInvalidate.planningMetadata.cacheHit).toBe(false);
  });
});

describe('StrategyPlanner.plan — goal interruption', () => {
  it('Retreat preempts an in-progress cached plan the instant self health drops, without waiting for TTL', () => {
    const planner = buildPlanner();
    const healthy = { publicGameState: { spaceContested: 0.6, openingAvailable: true, selfHealth: 0.9 } };
    const first = planner.plan(baseInputs(healthy), 1000);
    expect(first.goalId).not.toBe('retreat');

    const hurt = { publicGameState: { ...healthy.publicGameState, selfHealth: 0.1 } };
    const second = planner.plan(baseInputs(hurt), 1200);

    expect(second.goalId).toBe('retreat');
    expect(second.planningMetadata.replanned).toBe(true);
    expect(second.planningMetadata.interruptedGoalId).toBe(first.goalId);
  });

  it('does not report an interruption on the very first plan for a match (nothing to interrupt)', () => {
    const planner = buildPlanner();
    const intent = planner.plan(baseInputs({ publicGameState: { selfHealth: 0.1 } }));
    expect(intent.goalId).toBe('retreat');
    expect(intent.planningMetadata.interruptedGoalId).toBeNull();
  });
});

describe('StrategyPlanner.plan — awareness budget end to end', () => {
  const richInputs = baseInputs({
    awarenessBudget: 0.95,
    publicGameState: { openingAvailable: true },
    semanticProfile: [{ dimension: 'predictability', gameId: 'game-1', value: 0.8, confidence: 0.6, samples: 15 }],
    patterns: [{ patternId: 'dodgeDirection:left', detectorId: 'dodgeDirection', patternKey: 'left', category: 'movement', state: 'confirmed', confidence: 0.6, description: 'x' }],
  });

  it('a beginner-budget plan never reads semantic profile or pattern data, even when it is present in the raw inputs', () => {
    const planner = buildPlanner();
    const intent = planner.plan({ ...richInputs, awarenessBudget: 0.1 });
    expect(intent.awarenessUsed.tier).toBe('beginner');
    expect(intent.awarenessUsed.usedSemanticProfile).toBe(false);
    expect(intent.awarenessUsed.semanticDimensionsRead).toEqual([]);
    expect(intent.awarenessUsed.patternIdsRead).toEqual([]);
  });

  it('an expert-budget plan with the same raw inputs genuinely reads and reports specific dimensions/patterns used', () => {
    const planner = buildPlanner();
    const intent = planner.plan(richInputs);
    expect(intent.awarenessUsed.tier).toBe('expert');
    expect(intent.awarenessUsed.semanticDimensionsRead).toContain('predictability');
    expect(intent.awarenessUsed.patternIdsRead).toContain('dodgeDirection:left');
  });

  it('awarenessBudget on the intent always matches what the caller supplied', () => {
    const planner = buildPlanner();
    const intent = planner.plan(baseInputs({ awarenessBudget: 0.42 }));
    expect(intent.awarenessBudget).toBe(0.42);
  });
});

describe('StrategyPlanner.plan — personality is recorded, never mutates memory', () => {
  it('the resulting intent records exactly the personality supplied', () => {
    const planner = buildPlanner();
    const intent = planner.plan(baseInputs({ personality: 'psychological' }));
    expect(intent.personality).toBe('psychological');
  });

  it('planning never mutates the PlanningInputs object passed in', () => {
    const planner = buildPlanner();
    const inputs = baseInputs({ semanticProfile: [{ dimension: 'aggression', gameId: 'g1', value: 0.5, confidence: 0.5, samples: 5 }] });
    const snapshot = JSON.stringify(inputs);
    planner.plan(inputs);
    expect(JSON.stringify(inputs)).toBe(snapshot);
  });
});
