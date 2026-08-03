import { describe, it, expect } from 'vitest';
import { UNOBSERVED_DIMENSION } from '@adaptive-ai/memory-engine';
import { BaseCategoricalAnalyzer, BaseDimensionAnalyzer } from '../analyzer';
import { AnalyzerRunContext, DimensionAnalyzerMetadata, DimensionAnalyzerResult, ShortTermEventRef } from '../types';
import { makeMatch, makeRunContext } from './fixtures';

class FixedAnalyzer extends BaseDimensionAnalyzer {
  readonly metadata: DimensionAnalyzerMetadata = { id: 'fixed', displayName: 'Fixed', version: 1, kind: 'continuous', scope: 'per-game', description: 'test' };
  private count = 0;
  protected resetAccumulator(): void {
    this.count = 0;
  }
  consumeEvent(_e: ShortTermEventRef, _ctx: AnalyzerRunContext): void {
    this.count += 1;
  }
  consumeMatch(_ctx: AnalyzerRunContext): void {}
  protected deriveResult(): DimensionAnalyzerResult {
    return { entries: [{ key: 'fixed', observation: 0.7, sampleCount: this.count }], matchConfidence: this.count > 0 ? 0.9 : 0 };
  }
}

describe('BaseDimensionAnalyzer', () => {
  it('update() delegates to the shared EWMA primitive (whitepaper §3.1 math, not reimplemented)', () => {
    const a = new FixedAnalyzer();
    const next = a.update(UNOBSERVED_DIMENSION, 0.8, 10, 0.02);
    expect(next.value).toBe(0.8); // first observation: alpha=1
    expect(next.samples).toBe(1);
  });

  it('confidence() reflects the matchConfidence of the most recent calculate() call, 0 before any run', () => {
    const a = new FixedAnalyzer();
    expect(a.confidence()).toBe(0);
    a.initialize(makeRunContext({ match: makeMatch() }));
    a.consumeEvent({ ts: 0, type: 'X', payload: {} }, makeRunContext());
    a.calculate();
    expect(a.confidence()).toBe(0.9);
  });

  it('reset() clears the accumulator and the memoized confidence so the instance is safe to reuse', () => {
    const a = new FixedAnalyzer();
    a.initialize(makeRunContext({ match: makeMatch() }));
    a.consumeEvent({ ts: 0, type: 'X', payload: {} }, makeRunContext());
    a.calculate();
    expect(a.confidence()).toBe(0.9);
    a.reset();
    expect(a.confidence()).toBe(0);
  });

  it('initialize() resets any state left over from a prior run on the same instance', () => {
    const a = new FixedAnalyzer();
    a.initialize(makeRunContext({ match: makeMatch() }));
    a.consumeEvent({ ts: 0, type: 'X', payload: {} }, makeRunContext());
    a.calculate();
    a.initialize(makeRunContext({ match: makeMatch() })); // fresh run, no events consumed yet
    expect(a.calculate().matchConfidence).toBe(0);
  });
});

class TallyingCategoricalAnalyzer extends BaseCategoricalAnalyzer {
  readonly metadata: DimensionAnalyzerMetadata = { id: 'cat', displayName: 'Cat', version: 1, kind: 'categorical', scope: 'per-game', description: 'test' };
  consumeEvent(event: ShortTermEventRef, _ctx: AnalyzerRunContext): void {
    if (typeof event.payload.category === 'string') this.tally(event.payload.category);
  }
}

describe('BaseCategoricalAnalyzer', () => {
  it('produces one entry per observed category, keyed by `${id}:${category}`, with observation as that category\'s share', () => {
    const a = new TallyingCategoricalAnalyzer();
    const ctx = makeRunContext({ match: makeMatch() });
    a.initialize(ctx);
    a.consumeEvent({ ts: 0, type: 'X', payload: { category: 'x' } }, ctx);
    a.consumeEvent({ ts: 0, type: 'X', payload: { category: 'x' } }, ctx);
    a.consumeEvent({ ts: 0, type: 'X', payload: { category: 'y' } }, ctx);
    const result = a.calculate();
    const x = result.entries.find((e) => e.key === 'cat:x')!;
    const y = result.entries.find((e) => e.key === 'cat:y')!;
    expect(x.observation).toBeCloseTo(2 / 3, 10);
    expect(y.observation).toBeCloseTo(1 / 3, 10);
  });

  it('empty accumulator produces an empty result with zero matchConfidence', () => {
    const a = new TallyingCategoricalAnalyzer();
    a.initialize(makeRunContext({ match: makeMatch() }));
    const result = a.calculate();
    expect(result.entries).toHaveLength(0);
    expect(result.matchConfidence).toBe(0);
  });
});
