import { describe, it, expect } from 'vitest';
import { BaseConsideration } from '../consideration';
import { DecisionRegistry } from '../registry';
import { DuplicateConsiderationError, CyclicConsiderationDependencyError, UnknownConsiderationDependencyError } from '../errors';
import { ConsiderationContext, ConsiderationMetadata } from '../types';
import { buildAction, makeAwarenessAccumulator, buildStrategicIntent } from './fixtures';

class StubConsideration extends BaseConsideration {
  readonly metadata: ConsiderationMetadata;
  constructor(id: string, dependsOn?: string[]) {
    super();
    this.metadata = { id, displayName: id, category: 'tactical', version: 1, dependsOn, description: 'stub' };
  }
  protected score(): { value: number; reasoning: Record<string, unknown> } {
    return { value: 0.6, reasoning: {} };
  }
}

class ThrowingConsideration extends StubConsideration {
  evaluate(): never {
    throw new Error('boom');
  }
}

function makeCtx(): Omit<ConsiderationContext, 'siblingResults'> {
  return {
    action: buildAction('a1'),
    now: 1000,
    inputs: { strategicIntent: buildStrategicIntent(), matchContext: { matchId: 'm', playerId: 'p', gameId: 'g', elapsedMs: 0 }, publicGameState: {}, semanticProfile: [], patterns: [], awarenessBudget: 0.9, personality: 'aggressive' },
    worldFacts: {},
    awarenessUsed: makeAwarenessAccumulator(),
  };
}

describe('DecisionRegistry — registration', () => {
  it('registers and lists considerations by metadata', () => {
    const registry = new DecisionRegistry();
    registry.register(() => new StubConsideration('a'));
    registry.register(() => new StubConsideration('b'));
    expect(registry.list().map((m) => m.id).sort()).toEqual(['a', 'b']);
    expect(registry.has('a')).toBe(true);
    expect(registry.has('z')).toBe(false);
  });

  it('rejects a duplicate consideration id', () => {
    const registry = new DecisionRegistry();
    registry.register(() => new StubConsideration('a'));
    expect(() => registry.register(() => new StubConsideration('a'))).toThrow(DuplicateConsiderationError);
  });

  it('unregister removes a consideration and invalidates the cached order', () => {
    const registry = new DecisionRegistry();
    registry.register(() => new StubConsideration('a'));
    expect(registry.unregister('a')).toBe(true);
    expect(registry.has('a')).toBe(false);
    expect(registry.unregister('a')).toBe(false);
  });
});

describe('DecisionRegistry — execution order', () => {
  it('orders considerations so a dependency always precedes its dependent', () => {
    const registry = new DecisionRegistry();
    registry.register(() => new StubConsideration('c', ['b']));
    registry.register(() => new StubConsideration('a'));
    registry.register(() => new StubConsideration('b', ['a']));
    const order = registry.executionOrder();
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  it('throws UnknownConsiderationDependencyError for a missing dependency', () => {
    const registry = new DecisionRegistry();
    registry.register(() => new StubConsideration('a', ['missing']));
    expect(() => registry.executionOrder()).toThrow(UnknownConsiderationDependencyError);
  });

  it('throws CyclicConsiderationDependencyError on a circular dependsOn chain', () => {
    const registry = new DecisionRegistry();
    registry.register(() => new StubConsideration('a', ['b']));
    registry.register(() => new StubConsideration('b', ['a']));
    expect(() => registry.executionOrder()).toThrow(CyclicConsiderationDependencyError);
  });
});

describe('DecisionRegistry — evaluation / failure isolation', () => {
  it('evaluates every consideration, populating siblingResults for dependents', () => {
    const registry = new DecisionRegistry();
    registry.register(() => new StubConsideration('a'));
    registry.register(() => new StubConsideration('b', ['a']));
    const { outcomes } = registry.evaluateAll(makeCtx());
    expect(outcomes.every((o) => o.error === null)).toBe(true);
    expect(outcomes.find((o) => o.considerationId === 'b')!.result!.value).toBe(0.6);
  });

  it('isolates a failing consideration: its error is recorded but every other consideration still evaluates', () => {
    const registry = new DecisionRegistry();
    registry.register(() => new ThrowingConsideration('bad'));
    registry.register(() => new StubConsideration('good'));
    const { outcomes } = registry.evaluateAll(makeCtx());

    const bad = outcomes.find((o) => o.considerationId === 'bad')!;
    const good = outcomes.find((o) => o.considerationId === 'good')!;
    expect(bad.error).toContain('boom');
    expect(bad.result).toBeNull();
    expect(good.error).toBeNull();
    expect(good.result!.value).toBe(0.6);
  });
});
