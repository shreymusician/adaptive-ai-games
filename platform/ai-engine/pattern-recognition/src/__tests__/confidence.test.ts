import { describe, it, expect } from 'vitest';
import { applyPatternObservation, decayDormantConfidence, UNOBSERVED_PATTERN } from '../confidence';
import { PatternTuning } from '../types';

function tuning(overrides: Partial<PatternTuning> = {}): PatternTuning {
  return {
    k: 10,
    concentrationBaseline: 0.5,
    contradictionDecayRate: 0.3,
    decayRatePerDay: 0.05,
    lifecycle: { confirmedConfidence: 0.5, strongConfidence: 0.8, retiredConfidence: 0.15 },
    ...overrides,
  };
}

describe('applyPatternObservation — volume + concentration', () => {
  it('a perfectly consistent, high-volume pattern approaches high confidence', () => {
    let state = UNOBSERVED_PATTERN;
    for (let i = 0; i < 30; i++) {
      state = applyPatternObservation(state, 1, 1, tuning());
    }
    expect(state.confidence).toBeGreaterThan(0.8);
    expect(state.observationCount).toBe(30);
    expect(state.supportingEvidence).toBe(30);
  });

  it('never becomes certain after only a few observations, even if all consistent', () => {
    const state = applyPatternObservation(UNOBSERVED_PATTERN, 3, 3, tuning());
    expect(state.confidence).toBeLessThan(0.5);
  });

  it('confidence grows gradually and monotonically under consistent evidence', () => {
    let state = UNOBSERVED_PATTERN;
    const confidences: number[] = [];
    for (let i = 0; i < 15; i++) {
      state = applyPatternObservation(state, 1, 1, tuning());
      confidences.push(state.confidence);
    }
    for (let i = 1; i < confidences.length; i++) {
      expect(confidences[i]).toBeGreaterThanOrEqual(confidences[i - 1]);
    }
  });

  it('a share at exactly the concentration baseline (no better than chance) never clears confidence, regardless of volume', () => {
    let state = UNOBSERVED_PATTERN;
    for (let i = 0; i < 50; i++) {
      state = applyPatternObservation(state, 2, 1, tuning({ concentrationBaseline: 0.5 })); // exactly 50% share every match
    }
    expect(state.confidence).toBeCloseTo(0, 5);
  });

  it('higher concentration (further above baseline) yields higher confidence at the same volume', () => {
    const weak = applyPatternObservation(UNOBSERVED_PATTERN, 10, 6, tuning({ concentrationBaseline: 0.5 })); // 60% share
    const strong = applyPatternObservation(UNOBSERVED_PATTERN, 10, 9, tuning({ concentrationBaseline: 0.5 })); // 90% share
    expect(strong.confidence).toBeGreaterThan(weak.confidence);
  });

  it('rejects opportunities <= 0', () => {
    expect(() => applyPatternObservation(UNOBSERVED_PATTERN, 0, 0, tuning())).toThrow(RangeError);
  });

  it('rejects matches outside [0, opportunities]', () => {
    expect(() => applyPatternObservation(UNOBSERVED_PATTERN, 5, 6, tuning())).toThrow(RangeError);
    expect(() => applyPatternObservation(UNOBSERVED_PATTERN, 5, -1, tuning())).toThrow(RangeError);
  });

  it('does not mutate the prior state', () => {
    const prior = { observationCount: 5, supportingEvidence: 5, confidence: 0.3 };
    const frozen = { ...prior };
    applyPatternObservation(prior, 1, 1, tuning());
    expect(prior).toEqual(frozen);
  });
});

describe('applyPatternObservation — asymmetric contradiction decay', () => {
  it('a contradicting match caps confidence below what the formula alone would give, decaying faster than confirmation grows it', () => {
    let state = UNOBSERVED_PATTERN;
    for (let i = 0; i < 20; i++) state = applyPatternObservation(state, 1, 1, tuning());
    const beforeContradiction = state.confidence;

    const contradicted = applyPatternObservation(state, 2, 0, tuning({ contradictionDecayRate: 0.5 }));
    // The contradiction penalty caps confidence at prior * (1 - 0.5) = beforeContradiction * 0.5.
    expect(contradicted.confidence).toBeLessThanOrEqual(beforeContradiction * 0.5 + 1e-9);
  });

  it('a single contradicting match drops confidence by MORE than a single confirming match raises it, at the same volume', () => {
    let base = UNOBSERVED_PATTERN;
    for (let i = 0; i < 20; i++) base = applyPatternObservation(base, 1, 1, tuning());

    const afterConfirm = applyPatternObservation(base, 1, 1, tuning());
    const afterContradict = applyPatternObservation(base, 1, 0, tuning());

    const gain = afterConfirm.confidence - base.confidence;
    const loss = base.confidence - afterContradict.confidence;
    expect(loss).toBeGreaterThan(gain);
  });

  it('a fully contradicting match (matches=0) still increases observationCount but drives confidence down', () => {
    let state = UNOBSERVED_PATTERN;
    for (let i = 0; i < 10; i++) state = applyPatternObservation(state, 1, 1, tuning());
    const contradicted = applyPatternObservation(state, 3, 0, tuning());
    expect(contradicted.observationCount).toBe(13);
    expect(contradicted.confidence).toBeLessThan(state.confidence);
  });
});

describe('decayDormantConfidence', () => {
  it('reuses Memory Engine\'s decayConfidence verbatim: no change with zero elapsed time or zero rate', () => {
    expect(decayDormantConfidence(0.7, 0, 0.05)).toBe(0.7);
    expect(decayDormantConfidence(0.7, 30, 0)).toBe(0.7);
  });

  it('decays gradually with elapsed time, never below 0', () => {
    const decayed = decayDormantConfidence(0.7, 30, 0.05);
    expect(decayed).toBeLessThan(0.7);
    expect(decayed).toBeGreaterThan(0);
  });
});

describe('applyPatternObservation — randomized input', () => {
  it('confidence always stays within [0, 1] under random observation batches', () => {
    for (let trial = 0; trial < 30; trial++) {
      let state = UNOBSERVED_PATTERN;
      for (let i = 0; i < 20; i++) {
        const opportunities = 1 + Math.floor(Math.random() * 5);
        const matches = Math.floor(Math.random() * (opportunities + 1));
        state = applyPatternObservation(state, opportunities, matches, tuning());
        expect(state.confidence).toBeGreaterThanOrEqual(0);
        expect(state.confidence).toBeLessThanOrEqual(1);
      }
    }
  });
});
