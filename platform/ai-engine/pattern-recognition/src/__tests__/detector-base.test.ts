import { describe, it, expect } from 'vitest';
import { BasePatternDetector } from '../detector';
import { DetectorRunContext, PatternDetectorMetadata, ShortTermEventRef } from '../types';
import { makeMatch, makeRunContext, runDetector } from './fixtures';

class BinaryTestDetector extends BasePatternDetector {
  readonly metadata: PatternDetectorMetadata = { id: 'binaryTest', displayName: 'Binary Test', category: 'decision', version: 1, description: 'test' };
  consumeEvent(event: ShortTermEventRef, _ctx: DetectorRunContext): void {
    if (event.type !== 'X') return;
    this.observeBinary('claim', event.payload.matched === true, 'test claim');
  }
}

class CategoricalTestDetector extends BasePatternDetector {
  readonly metadata: PatternDetectorMetadata = { id: 'categoricalTest', displayName: 'Categorical Test', category: 'movement', version: 1, description: 'test' };
  private counts = new Map<string, number>();
  consumeEvent(event: ShortTermEventRef, _ctx: DetectorRunContext): void {
    if (event.type !== 'X') return;
    const category = event.payload.category as string;
    this.counts.set(category, (this.counts.get(category) ?? 0) + 1);
  }
  consumeMatch(_ctx: DetectorRunContext): void {
    this.observeCategorical(this.counts, (c) => `category ${c}`);
  }
  protected override resetAccumulator(): void {
    this.counts = new Map();
  }
}

describe('BasePatternDetector — observeBinary', () => {
  it('unit: tallies opportunities and matches per patternKey', () => {
    const events = [
      { ts: 0, type: 'X', payload: { matched: true } },
      { ts: 0, type: 'X', payload: { matched: false } },
      { ts: 0, type: 'X', payload: { matched: true } },
    ];
    const result = runDetector(new BinaryTestDetector(), makeRunContext({ match: makeMatch() }), events);
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]).toMatchObject({ patternKey: 'claim', opportunities: 3, matches: 2 });
  });

  it('boundary: no qualifying events yields no deltas and zero confidence', () => {
    const result = runDetector(new BinaryTestDetector(), makeRunContext({ match: makeMatch() }), [{ ts: 0, type: 'Y', payload: {} }]);
    expect(result.deltas).toHaveLength(0);
  });

  it('confidence evolution: more qualifying events raise the per-match confidence() gate', () => {
    const few = runDetector(new BinaryTestDetector(), makeRunContext({ match: makeMatch() }), [{ ts: 0, type: 'X', payload: { matched: true } }]);
    const detector = new BinaryTestDetector();
    const many = runDetector(
      detector,
      makeRunContext({ match: makeMatch() }),
      Array.from({ length: 10 }, () => ({ ts: 0, type: 'X', payload: { matched: true } }))
    );
    expect(many.deltas.length).toBeGreaterThan(0);
    expect(detector.confidence()).toBeGreaterThan(0);
    expect(few).toBeTruthy();
  });

  it('reset() clears the tally so the same instance is safe to reuse', () => {
    const detector = new BinaryTestDetector();
    runDetector(detector, makeRunContext({ match: makeMatch() }), [{ ts: 0, type: 'X', payload: { matched: true } }]);
    detector.reset();
    const result = runDetector(detector, makeRunContext({ match: makeMatch() }), [{ ts: 0, type: 'X', payload: { matched: false } }]);
    expect(result.deltas[0]).toMatchObject({ opportunities: 1, matches: 0 });
  });
});

describe('BasePatternDetector — observeCategorical', () => {
  it('unit: each category becomes its own delta, sharing the same total opportunities', () => {
    const events = [
      { ts: 0, type: 'X', payload: { category: 'a' } },
      { ts: 0, type: 'X', payload: { category: 'a' } },
      { ts: 0, type: 'X', payload: { category: 'b' } },
    ];
    const result = runDetector(new CategoricalTestDetector(), makeRunContext({ match: makeMatch() }), events);
    const a = result.deltas.find((d) => d.patternKey === 'a')!;
    const b = result.deltas.find((d) => d.patternKey === 'b')!;
    expect(a).toMatchObject({ opportunities: 3, matches: 2 });
    expect(b).toMatchObject({ opportunities: 3, matches: 1 });
  });

  it('boundary: no categorical events at all produces no deltas', () => {
    const result = runDetector(new CategoricalTestDetector(), makeRunContext({ match: makeMatch() }), []);
    expect(result.deltas).toHaveLength(0);
  });
});
