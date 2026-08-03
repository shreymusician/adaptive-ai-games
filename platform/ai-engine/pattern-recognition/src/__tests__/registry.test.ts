import { describe, it, expect } from 'vitest';
import { BasePatternDetector } from '../detector';
import { PatternRegistry } from '../registry';
import { CyclicDetectorDependencyError, DuplicateDetectorError, UnknownDetectorDependencyError } from '../errors';
import { DetectorResult, DetectorRunContext, PatternDetectorMetadata, ShortTermEventRef } from '../types';
import { makeMatch, makeRunContext } from './fixtures';

class StubDetector extends BasePatternDetector {
  readonly metadata: PatternDetectorMetadata;
  constructor(id: string, dependsOn?: string[]) {
    super();
    this.metadata = { id, displayName: id, category: 'decision', version: 1, dependsOn, description: 'stub' };
  }
  consumeEvent(_e: ShortTermEventRef, _ctx: DetectorRunContext): void {}
  consumeMatch(_ctx: DetectorRunContext): void {
    this.observeBinary(this.metadata.id, true, 'stub');
  }
}

class ThrowingDetector extends StubDetector {
  override consumeMatch(_ctx: DetectorRunContext): void {
    throw new Error('boom');
  }
}

describe('PatternRegistry — registration', () => {
  it('registers and lists detectors by metadata', () => {
    const registry = new PatternRegistry();
    registry.register(() => new StubDetector('a'));
    registry.register(() => new StubDetector('b'));
    expect(registry.list().map((m) => m.id).sort()).toEqual(['a', 'b']);
    expect(registry.has('a')).toBe(true);
  });

  it('rejects a duplicate detector id', () => {
    const registry = new PatternRegistry();
    registry.register(() => new StubDetector('a'));
    expect(() => registry.register(() => new StubDetector('a'))).toThrow(DuplicateDetectorError);
  });

  it('unregister removes a detector', () => {
    const registry = new PatternRegistry();
    registry.register(() => new StubDetector('a'));
    expect(registry.unregister('a')).toBe(true);
    expect(registry.has('a')).toBe(false);
  });
});

describe('PatternRegistry — execution order', () => {
  it('orders detectors so a dependency always precedes its dependent', () => {
    const registry = new PatternRegistry();
    registry.register(() => new StubDetector('c', ['b']));
    registry.register(() => new StubDetector('a'));
    registry.register(() => new StubDetector('b', ['a']));
    const order = registry.executionOrder();
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  it('throws UnknownDetectorDependencyError for a dependsOn naming an unregistered detector', () => {
    const registry = new PatternRegistry();
    registry.register(() => new StubDetector('a', ['missing']));
    expect(() => registry.executionOrder()).toThrow(UnknownDetectorDependencyError);
  });

  it('throws CyclicDetectorDependencyError on a circular dependsOn chain', () => {
    const registry = new PatternRegistry();
    registry.register(() => new StubDetector('a', ['b']));
    registry.register(() => new StubDetector('b', ['a']));
    expect(() => registry.executionOrder()).toThrow(CyclicDetectorDependencyError);
  });
});

describe('PatternRegistry — execution / failure isolation / detector integration', () => {
  it('runs every detector and populates siblingResults for dependents', () => {
    const registry = new PatternRegistry();
    registry.register(() => new StubDetector('a'));
    registry.register(() => new StubDetector('b', ['a']));
    const { outcomes } = registry.execute(makeRunContext({ match: makeMatch() }), []);
    expect(outcomes.every((o) => o.error === null)).toBe(true);
    const b = outcomes.find((o) => o.detectorId === 'b')!;
    expect(b.result!.deltas).toHaveLength(1);
  });

  it('isolates a failing detector: its error is recorded but every other detector still runs', () => {
    const registry = new PatternRegistry();
    registry.register(() => new ThrowingDetector('bad'));
    registry.register(() => new StubDetector('good'));
    const { outcomes } = registry.execute(makeRunContext({ match: makeMatch() }), []);

    const bad = outcomes.find((o) => o.detectorId === 'bad')!;
    const good = outcomes.find((o) => o.detectorId === 'good')!;
    expect(bad.error).toContain('boom');
    expect(bad.result).toBeNull();
    expect(good.error).toBeNull();
    expect(good.result!.deltas).toHaveLength(1);
  });

  it("a dependent detector isn't itself broken just because its dependency failed", () => {
    const registry = new PatternRegistry();
    registry.register(() => new ThrowingDetector('bad'));
    registry.register(() => new StubDetector('dependent', ['bad']));
    const { outcomes } = registry.execute(makeRunContext({ match: makeMatch() }), []);
    const dependent = outcomes.find((o) => o.detectorId === 'dependent')!;
    expect(dependent.error).toBeNull();
    expect(dependent.result!.deltas).toHaveLength(1);
  });
});
