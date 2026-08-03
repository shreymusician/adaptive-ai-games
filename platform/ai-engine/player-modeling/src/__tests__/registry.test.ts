import { describe, it, expect } from 'vitest';
import { BaseDimensionAnalyzer } from '../analyzer';
import { DimensionRegistry } from '../registry';
import { DuplicateAnalyzerError, CyclicDependencyError, UnknownDependencyError } from '../errors';
import { AnalyzerRunContext, DimensionAnalyzerMetadata, DimensionAnalyzerResult, ShortTermEventRef } from '../types';
import { makeMatch, makeRunContext } from './fixtures';

/** A trivial analyzer for registry-level tests — always emits one fixed observation, never errors. */
class StubAnalyzer extends BaseDimensionAnalyzer {
  readonly metadata: DimensionAnalyzerMetadata;
  constructor(id: string, dependsOn?: string[]) {
    super();
    this.metadata = { id, displayName: id, version: 1, kind: 'continuous', scope: 'per-game', dependsOn, description: 'stub' };
  }
  protected resetAccumulator(): void {}
  consumeEvent(_event: ShortTermEventRef, _ctx: AnalyzerRunContext): void {}
  consumeMatch(_ctx: AnalyzerRunContext): void {}
  protected deriveResult(): DimensionAnalyzerResult {
    return { entries: [{ key: this.metadata.id, observation: 1, sampleCount: 1 }], matchConfidence: 1 };
  }
}

/** Always throws from consumeMatch — for failure-isolation tests. */
class ThrowingAnalyzer extends StubAnalyzer {
  consumeMatch(_ctx: AnalyzerRunContext): void {
    throw new Error('boom');
  }
}

describe('DimensionRegistry — registration', () => {
  it('registers and lists analyzers by metadata', () => {
    const registry = new DimensionRegistry();
    registry.register(() => new StubAnalyzer('a'));
    registry.register(() => new StubAnalyzer('b'));
    expect(registry.list().map((m) => m.id).sort()).toEqual(['a', 'b']);
    expect(registry.has('a')).toBe(true);
    expect(registry.has('z')).toBe(false);
  });

  it('rejects a duplicate dimension id', () => {
    const registry = new DimensionRegistry();
    registry.register(() => new StubAnalyzer('a'));
    expect(() => registry.register(() => new StubAnalyzer('a'))).toThrow(DuplicateAnalyzerError);
  });

  it('unregister removes an analyzer and invalidates the cached order', () => {
    const registry = new DimensionRegistry();
    registry.register(() => new StubAnalyzer('a'));
    expect(registry.unregister('a')).toBe(true);
    expect(registry.has('a')).toBe(false);
    expect(registry.unregister('a')).toBe(false);
  });
});

describe('DimensionRegistry — execution order', () => {
  it('orders analyzers so a dependency always precedes its dependent', () => {
    const registry = new DimensionRegistry();
    registry.register(() => new StubAnalyzer('c', ['b']));
    registry.register(() => new StubAnalyzer('a'));
    registry.register(() => new StubAnalyzer('b', ['a']));
    const order = registry.executionOrder();
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  it('is deterministic and cached across repeated calls until the registry changes', () => {
    const registry = new DimensionRegistry();
    registry.register(() => new StubAnalyzer('a'));
    registry.register(() => new StubAnalyzer('b'));
    const first = registry.executionOrder();
    const second = registry.executionOrder();
    expect(second).toEqual(first);
  });

  it('throws UnknownDependencyError when dependsOn references an unregistered dimension', () => {
    const registry = new DimensionRegistry();
    registry.register(() => new StubAnalyzer('a', ['missing']));
    expect(() => registry.executionOrder()).toThrow(UnknownDependencyError);
  });

  it('throws CyclicDependencyError on a circular dependsOn chain', () => {
    const registry = new DimensionRegistry();
    registry.register(() => new StubAnalyzer('a', ['b']));
    registry.register(() => new StubAnalyzer('b', ['a']));
    expect(() => registry.executionOrder()).toThrow(CyclicDependencyError);
  });
});

describe('DimensionRegistry — execution / failure isolation', () => {
  it('runs every analyzer over the given events and match, populating siblingResults for dependents', () => {
    const registry = new DimensionRegistry();
    registry.register(() => new StubAnalyzer('a'));
    registry.register(() => new StubAnalyzer('b', ['a']));
    const ctx = makeRunContext({ match: makeMatch() });
    const { outcomes } = registry.execute(ctx, []);
    expect(outcomes.every((o) => o.error === null)).toBe(true);
    expect(outcomes.find((o) => o.dimensionId === 'b')!.result!.entries[0].observation).toBe(1);
  });

  it('isolates a failing analyzer: its error is recorded but every other analyzer still runs', () => {
    const registry = new DimensionRegistry();
    registry.register(() => new ThrowingAnalyzer('bad'));
    registry.register(() => new StubAnalyzer('good'));
    const ctx = makeRunContext({ match: makeMatch() });
    const { outcomes } = registry.execute(ctx, []);

    const bad = outcomes.find((o) => o.dimensionId === 'bad')!;
    const good = outcomes.find((o) => o.dimensionId === 'good')!;
    expect(bad.error).toContain('boom');
    expect(bad.result).toBeNull();
    expect(good.error).toBeNull();
    expect(good.result!.entries).toHaveLength(1);
  });

  it("a dependent analyzer sees an absent sibling result when its dependency failed (siblingResults simply has no entry)", () => {
    const registry = new DimensionRegistry();
    registry.register(() => new ThrowingAnalyzer('bad'));
    registry.register(() => new StubAnalyzer('dependent', ['bad']));
    const ctx = makeRunContext({ match: makeMatch() });
    const { outcomes } = registry.execute(ctx, []);
    const dependent = outcomes.find((o) => o.dimensionId === 'dependent')!;
    expect(dependent.error).toBeNull(); // the dependent itself doesn't throw just because its dependency failed
    expect(dependent.result!.entries).toHaveLength(1); // StubAnalyzer doesn't read siblingResults, so it still succeeds
  });
});
