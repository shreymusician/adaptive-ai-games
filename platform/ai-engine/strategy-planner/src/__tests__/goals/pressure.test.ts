import { describe, it, expect } from 'vitest';
import { PressurePlayerGoal } from '../../goals/pressure-player';
import { ForceMovementGoal } from '../../goals/force-movement';
import { ForceReloadGoal } from '../../goals/force-reload';
import { ControlSpaceGoal } from '../../goals/control-space';
import { DenyResourcesGoal } from '../../goals/deny-resources';
import { SplitTargetsGoal } from '../../goals/split-targets';
import { makeGoalCtx } from '../fixtures';

describe('PressurePlayerGoal', () => {
  const goal = new PressurePlayerGoal();

  it('is ineligible with no opening and a healthy player', () => {
    expect(goal.evaluate(makeGoalCtx({ openingAvailable: false, playerHealthLow: false })).preconditionsMet).toBe(false);
  });

  it('utility increases when both an opening AND a weakened player apply', () => {
    const openingOnly = goal.evaluate(makeGoalCtx({ openingAvailable: true, playerHealthLow: false }));
    const both = goal.evaluate(makeGoalCtx({ openingAvailable: true, playerHealthLow: true }));
    expect(both.utility).toBeGreaterThan(openingOnly.utility);
  });

  it('costs more when the AI\'s own resources are low', () => {
    const flush = goal.evaluate(makeGoalCtx({ openingAvailable: true, selfResourcesLow: false }));
    const strapped = goal.evaluate(makeGoalCtx({ openingAvailable: true, selfResourcesLow: true }));
    expect(strapped.cost).toBeGreaterThan(flush.cost);
  });
});

describe('ForceMovementGoal', () => {
  const goal = new ForceMovementGoal();

  it('is ineligible when space is uncontested and no objective is threatened', () => {
    expect(goal.evaluate(makeGoalCtx({ spaceContested: false, objectiveThreatened: false })).preconditionsMet).toBe(false);
  });

  it('is eligible when space is contested', () => {
    const result = goal.evaluate(makeGoalCtx({ spaceContested: true, spaceContestedValue: 0.8 }));
    expect(result.preconditionsMet).toBe(true);
    expect(result.utility).toBeGreaterThan(0);
  });
});

describe('ForceReloadGoal', () => {
  const goal = new ForceReloadGoal();

  it('is ineligible when the AI\'s own resources are already low', () => {
    expect(goal.evaluate(makeGoalCtx({ selfResourcesLow: true, playerHighAggression: true })).preconditionsMet).toBe(false);
  });

  it('is eligible against an aggressive player with resources to spare', () => {
    const result = goal.evaluate(makeGoalCtx({ selfResourcesLow: false, playerHighAggression: true }));
    expect(result.preconditionsMet).toBe(true);
  });
});

describe('ControlSpaceGoal', () => {
  const goal = new ControlSpaceGoal();

  it('costs more when the AI is at low health', () => {
    const healthy = goal.evaluate(makeGoalCtx({ spaceContested: true, spaceContestedValue: 0.6, selfHealthLow: false }));
    const hurt = goal.evaluate(makeGoalCtx({ spaceContested: true, spaceContestedValue: 0.6, selfHealthLow: true }));
    expect(hurt.cost).toBeGreaterThan(healthy.cost);
  });
});

describe('DenyResourcesGoal', () => {
  const goal = new DenyResourcesGoal();

  it('is ineligible when the AI\'s own resources are low', () => {
    expect(goal.evaluate(makeGoalCtx({ selfResourcesLow: true })).preconditionsMet).toBe(false);
  });

  it('utility is boosted by known combat/exploration patterns', () => {
    const none = goal.evaluate(makeGoalCtx({ selfResourcesLow: false }));
    const both = goal.evaluate(makeGoalCtx({ selfResourcesLow: false, patternCategory_combat: true, patternCategory_exploration: true }));
    expect(both.utility).toBeGreaterThan(none.utility);
  });
});

describe('SplitTargetsGoal — opt-in genre-specific fact', () => {
  const goal = new SplitTargetsGoal();

  it('is ineligible for genres that never report multipleTargets', () => {
    expect(goal.evaluate(makeGoalCtx({})).preconditionsMet).toBe(false);
  });

  it('is eligible only when the plugin explicitly reports multiple targets', () => {
    const result = goal.evaluate(makeGoalCtx({ extra_multipleTargets: true, selfResourcesLow: false }));
    expect(result.preconditionsMet).toBe(true);
  });
});
