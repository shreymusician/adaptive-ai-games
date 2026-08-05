import { describe, it, expect } from 'vitest';
import { BaseGoal } from '../goal';
import { GoalRegistry } from '../registry';
import { DuplicateGoalError, CyclicGoalDependencyError, UnknownGoalDependencyError } from '../errors';
import { GoalEvaluationContext, GoalMetadata } from '../types';
import { baseInputs } from './fixtures';

/** A trivial goal for registry-level tests — always eligible, fixed utility/cost, never errors. */
class StubGoal extends BaseGoal {
  readonly metadata: GoalMetadata;
  constructor(id: string, dependsOn?: string[]) {
    super();
    this.metadata = { id, displayName: id, category: 'positioning', version: 1, dependsOn, interruptPriority: 0, description: 'stub' };
  }
  protected checkPreconditions(): boolean {
    return true;
  }
  protected computeUtility(): { utility: number; reasoning: Record<string, unknown> } {
    return { utility: 0.5, reasoning: {} };
  }
  protected computeCost(): number {
    return 0.2;
  }
  protected computeEffects(): Record<string, boolean | number> {
    return {};
  }
}

/** Always throws — for failure-isolation tests. */
class ThrowingGoal extends StubGoal {
  evaluate(): never {
    throw new Error('boom');
  }
}

function makeCtx(): Omit<GoalEvaluationContext, 'siblingResults'> {
  return { inputs: baseInputs(), worldState: {}, awarenessUsed: { tier: 'expert', budget: 0.9, usedRecentObservations: true, usedSemanticProfile: false, usedPatterns: false, usedEpisodicMemory: false, semanticDimensionsRead: new Set(), patternIdsRead: new Set(), episodeIdsRead: new Set() } };
}

describe('GoalRegistry — registration', () => {
  it('registers and lists goals by metadata', () => {
    const registry = new GoalRegistry();
    registry.register(() => new StubGoal('a'));
    registry.register(() => new StubGoal('b'));
    expect(registry.list().map((m) => m.id).sort()).toEqual(['a', 'b']);
    expect(registry.has('a')).toBe(true);
    expect(registry.has('z')).toBe(false);
  });

  it('rejects a duplicate goal id', () => {
    const registry = new GoalRegistry();
    registry.register(() => new StubGoal('a'));
    expect(() => registry.register(() => new StubGoal('a'))).toThrow(DuplicateGoalError);
  });

  it('unregister removes a goal and invalidates the cached order', () => {
    const registry = new GoalRegistry();
    registry.register(() => new StubGoal('a'));
    expect(registry.unregister('a')).toBe(true);
    expect(registry.has('a')).toBe(false);
    expect(registry.unregister('a')).toBe(false);
  });
});

describe('GoalRegistry — execution order', () => {
  it('orders goals so a dependency always precedes its dependent', () => {
    const registry = new GoalRegistry();
    registry.register(() => new StubGoal('c', ['b']));
    registry.register(() => new StubGoal('a'));
    registry.register(() => new StubGoal('b', ['a']));
    const order = registry.executionOrder();
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  it('is deterministic and cached across repeated calls until the registry changes', () => {
    const registry = new GoalRegistry();
    registry.register(() => new StubGoal('a'));
    registry.register(() => new StubGoal('b'));
    expect(registry.executionOrder()).toEqual(registry.executionOrder());
  });

  it('throws UnknownGoalDependencyError when dependsOn references an unregistered goal', () => {
    const registry = new GoalRegistry();
    registry.register(() => new StubGoal('a', ['missing']));
    expect(() => registry.executionOrder()).toThrow(UnknownGoalDependencyError);
  });

  it('throws CyclicGoalDependencyError on a circular dependsOn chain', () => {
    const registry = new GoalRegistry();
    registry.register(() => new StubGoal('a', ['b']));
    registry.register(() => new StubGoal('b', ['a']));
    expect(() => registry.executionOrder()).toThrow(CyclicGoalDependencyError);
  });
});

describe('GoalRegistry — evaluation / failure isolation', () => {
  it('evaluates every goal, populating siblingResults for dependents', () => {
    const registry = new GoalRegistry();
    registry.register(() => new StubGoal('a'));
    registry.register(() => new StubGoal('b', ['a']));
    const { outcomes } = registry.evaluateAll(makeCtx());
    expect(outcomes.every((o) => o.error === null)).toBe(true);
    expect(outcomes.find((o) => o.goalId === 'b')!.result!.utility).toBe(0.5);
  });

  it('isolates a failing goal: its error is recorded but every other goal still evaluates', () => {
    const registry = new GoalRegistry();
    registry.register(() => new ThrowingGoal('bad'));
    registry.register(() => new StubGoal('good'));
    const { outcomes } = registry.evaluateAll(makeCtx());

    const bad = outcomes.find((o) => o.goalId === 'bad')!;
    const good = outcomes.find((o) => o.goalId === 'good')!;
    expect(bad.error).toContain('boom');
    expect(bad.result).toBeNull();
    expect(good.error).toBeNull();
    expect(good.result!.utility).toBe(0.5);
  });

  it('a dependent goal is unaffected when its dependency failed (siblingResults simply has no entry for it)', () => {
    const registry = new GoalRegistry();
    registry.register(() => new ThrowingGoal('bad'));
    registry.register(() => new StubGoal('dependent', ['bad']));
    const { outcomes } = registry.evaluateAll(makeCtx());
    const dependent = outcomes.find((o) => o.goalId === 'dependent')!;
    expect(dependent.error).toBeNull();
    expect(dependent.result!.utility).toBe(0.5);
  });
});
