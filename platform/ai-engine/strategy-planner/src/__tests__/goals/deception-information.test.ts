import { describe, it, expect } from 'vitest';
import { CreateAmbushGoal } from '../../goals/create-ambush';
import { BreakPredictablePatternGoal } from '../../goals/break-predictable-pattern';
import { ScoutUnknownBehaviorGoal } from '../../goals/scout-unknown-behavior';
import { TestHypothesisGoal } from '../../goals/test-hypothesis';
import { makeGoalCtx } from '../fixtures';

describe('CreateAmbushGoal', () => {
  const goal = new CreateAmbushGoal();

  it('is ineligible with no exploitable pattern', () => {
    expect(goal.evaluate(makeGoalCtx({ hasExploitablePattern: false })).preconditionsMet).toBe(false);
  });

  it('is ineligible while the player is actively retreating (ambushing a retreat is pointless)', () => {
    expect(goal.evaluate(makeGoalCtx({ hasExploitablePattern: true, playerRetreating: true })).preconditionsMet).toBe(false);
  });

  it('utility is boosted by a known movement pattern specifically', () => {
    const generic = goal.evaluate(makeGoalCtx({ hasExploitablePattern: true, playerRetreating: false, exploitablePatternCount: 1 }));
    const movement = goal.evaluate(makeGoalCtx({ hasExploitablePattern: true, playerRetreating: false, exploitablePatternCount: 1, patternCategory_movement: true }));
    expect(movement.utility).toBeGreaterThan(generic.utility);
  });
});

describe('BreakPredictablePatternGoal', () => {
  const goal = new BreakPredictablePatternGoal();

  it('is ineligible with no predictability signal and no pattern', () => {
    expect(goal.evaluate(makeGoalCtx({ playerPredictable: false, hasExploitablePattern: false })).preconditionsMet).toBe(false);
  });

  it('utility is highest when both the profile AND a pattern agree the player is predictable', () => {
    const patternOnly = goal.evaluate(makeGoalCtx({ playerPredictable: false, hasExploitablePattern: true }));
    const both = goal.evaluate(makeGoalCtx({ playerPredictable: true, hasExploitablePattern: true }));
    expect(both.utility).toBeGreaterThan(patternOnly.utility);
  });
});

describe('ScoutUnknownBehaviorGoal', () => {
  const goal = new ScoutUnknownBehaviorGoal();

  it('is ineligible once the profile is populated and multiple patterns are confirmed', () => {
    const result = goal.evaluate(makeGoalCtx({ semanticProfileAvailable: true, exploitablePatternCount: 5 }));
    expect(result.preconditionsMet).toBe(false);
  });

  it('is eligible and high-utility with zero prior knowledge', () => {
    const result = goal.evaluate(makeGoalCtx({ semanticProfileAvailable: false, exploitablePatternCount: 0 }));
    expect(result.preconditionsMet).toBe(true);
    expect(result.utility).toBeGreaterThan(0.5);
  });

  it('utility tapers off as more patterns become known', () => {
    const thin = goal.evaluate(makeGoalCtx({ semanticProfileAvailable: false, exploitablePatternCount: 0 }));
    const thicker = goal.evaluate(makeGoalCtx({ semanticProfileAvailable: false, exploitablePatternCount: 1 }));
    expect(thicker.utility).toBeLessThan(thin.utility);
  });
});

describe('TestHypothesisGoal', () => {
  const goal = new TestHypothesisGoal();

  it('requires expert-tier awareness even if a pattern is technically present', () => {
    const result = goal.evaluate(makeGoalCtx({ awarenessTierExpert: false, hasExploitablePattern: true }));
    expect(result.preconditionsMet).toBe(false);
  });

  it('is eligible at expert tier with an exploitable pattern', () => {
    const result = goal.evaluate(makeGoalCtx({ awarenessTierExpert: true, hasExploitablePattern: true, exploitablePatternCount: 2 }));
    expect(result.preconditionsMet).toBe(true);
    expect(result.utility).toBeLessThanOrEqual(0.35); // deliberately a hedge, not a dominant utility
  });
});
