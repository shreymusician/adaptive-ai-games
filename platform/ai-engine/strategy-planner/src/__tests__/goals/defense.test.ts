import { describe, it, expect } from 'vitest';
import { RetreatGoal } from '../../goals/retreat';
import { ProtectObjectiveGoal } from '../../goals/protect-objective';
import { RegroupGoal } from '../../goals/regroup';
import { DelayEngagementGoal } from '../../goals/delay-engagement';
import { makeGoalCtx } from '../fixtures';

describe('RetreatGoal', () => {
  const goal = new RetreatGoal();

  it('is ineligible when self health is fine', () => {
    const result = goal.evaluate(makeGoalCtx({ selfHealthLow: false }));
    expect(result.preconditionsMet).toBe(false);
    expect(result.utility).toBe(0);
  });

  it('is eligible and highly urgent when self health is low', () => {
    const result = goal.evaluate(makeGoalCtx({ selfHealthLow: true, selfHealth: 0.1 }));
    expect(result.preconditionsMet).toBe(true);
    expect(result.utility).toBeGreaterThanOrEqual(0.8);
    expect(result.cost).toBeLessThan(0.3);
  });

  it('has the highest interruptPriority of any goal in this phase', () => {
    expect(goal.metadata.interruptPriority).toBe(10);
  });

  it('declares expectedEffects that resolve the low-health fact', () => {
    const result = goal.evaluate(makeGoalCtx({ selfHealthLow: true, selfHealth: 0.2 }));
    expect(result.expectedEffects.selfHealthLow).toBe(false);
  });
});

describe('ProtectObjectiveGoal', () => {
  const goal = new ProtectObjectiveGoal();

  it('is ineligible when no objective is threatened', () => {
    const result = goal.evaluate(makeGoalCtx({ objectiveThreatened: false }));
    expect(result.preconditionsMet).toBe(false);
  });

  it('is eligible and near-maximal utility when the objective is threatened', () => {
    const result = goal.evaluate(makeGoalCtx({ objectiveThreatened: true }));
    expect(result.preconditionsMet).toBe(true);
    expect(result.utility).toBeGreaterThanOrEqual(0.8);
  });
});

describe('RegroupGoal — guaranteed fallback', () => {
  const goal = new RegroupGoal();

  it('is always eligible regardless of world state', () => {
    expect(goal.evaluate(makeGoalCtx({})).preconditionsMet).toBe(true);
    expect(goal.evaluate(makeGoalCtx({ selfHealthLow: true, objectiveThreatened: true })).preconditionsMet).toBe(true);
  });

  it('never has interrupt priority (it is the passive default, not an interrupt)', () => {
    expect(goal.metadata.interruptPriority).toBe(0);
  });
});

describe('DelayEngagementGoal', () => {
  const goal = new DelayEngagementGoal();

  it('is ineligible with plenty of resources and a passive player', () => {
    const result = goal.evaluate(makeGoalCtx({ selfResourcesLow: false, playerHighAggression: false }));
    expect(result.preconditionsMet).toBe(false);
  });

  it('is eligible when self resources are low', () => {
    const result = goal.evaluate(makeGoalCtx({ selfResourcesLow: true }));
    expect(result.preconditionsMet).toBe(true);
    expect(result.utility).toBeGreaterThan(0);
  });

  it('is eligible when the player is aggressive and no opening exists', () => {
    const result = goal.evaluate(makeGoalCtx({ playerHighAggression: true, openingAvailable: false }));
    expect(result.preconditionsMet).toBe(true);
  });
});
