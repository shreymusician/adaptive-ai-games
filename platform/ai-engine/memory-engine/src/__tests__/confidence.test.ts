import { describe, it, expect } from 'vitest';
import { applyObservation, asymptoticConfidence, decayConfidence, UNOBSERVED_DIMENSION } from '../confidence';

describe('applyObservation (EWMA)', () => {
  it('starts a fresh dimension exactly at the first observation (alpha=1 on samples=0)', () => {
    const result = applyObservation(UNOBSERVED_DIMENSION, 0.8, 10, 0.02);
    expect(result.value).toBe(0.8); // alpha = 1/(1+0) = 1 -> value_new = observation
    expect(result.samples).toBe(1);
    expect(result.confidence).toBeCloseTo(1 - Math.exp(-1 / 10), 10);
  });

  it('moves value toward the observation, never past it, on subsequent updates', () => {
    let state = applyObservation(UNOBSERVED_DIMENSION, 1.0, 10, 0.02);
    state = applyObservation(state, 0.0, 10, 0.02);
    expect(state.value).toBeGreaterThan(0);
    expect(state.value).toBeLessThan(1);
  });

  it('never instantly jumps to certainty regardless of how extreme the observation is', () => {
    let state = UNOBSERVED_DIMENSION;
    for (let i = 0; i < 3; i++) {
      state = applyObservation(state, 1.0, 10, 0.02);
    }
    expect(state.confidence).toBeLessThan(1);
    expect(state.confidence).toBeGreaterThan(0);
  });

  it('confidence increases monotonically with more consistent samples', () => {
    let state = UNOBSERVED_DIMENSION;
    const confidences: number[] = [];
    for (let i = 0; i < 20; i++) {
      state = applyObservation(state, 0.5, 10, 0.02);
      confidences.push(state.confidence);
    }
    for (let i = 1; i < confidences.length; i++) {
      expect(confidences[i]).toBeGreaterThan(confidences[i - 1]);
    }
    expect(confidences.at(-1)!).toBeLessThan(1); // asymptotic — never reaches 1 even after 20 samples
  });

  it('alpha is bounded below by alphaMin so learning never fully stalls', () => {
    let state = UNOBSERVED_DIMENSION;
    for (let i = 0; i < 10_000; i++) {
      state = applyObservation(state, 1.0, 10, 0.1);
    }
    // With alphaMin=0.1, a single extreme observation still moves value by >= 10% of the remaining gap.
    const before = state.value;
    state = applyObservation(state, 0.0, 10, 0.1);
    expect(before - state.value).toBeGreaterThanOrEqual(0.1 * before - 1e-9);
  });

  it('rejects non-positive k', () => {
    expect(() => applyObservation(UNOBSERVED_DIMENSION, 1, 0, 0.02)).toThrow(RangeError);
    expect(() => applyObservation(UNOBSERVED_DIMENSION, 1, -5, 0.02)).toThrow(RangeError);
  });

  it('rejects alphaMin outside [0,1]', () => {
    expect(() => applyObservation(UNOBSERVED_DIMENSION, 1, 10, -0.1)).toThrow(RangeError);
    expect(() => applyObservation(UNOBSERVED_DIMENSION, 1, 10, 1.5)).toThrow(RangeError);
  });

  it('does not mutate the input snapshot', () => {
    const input = { value: 0.5, confidence: 0.3, samples: 5 };
    const frozen = { ...input };
    applyObservation(input, 0.9, 10, 0.02);
    expect(input).toEqual(frozen);
  });
});

describe('asymptoticConfidence', () => {
  it('is 0 at 0 samples', () => {
    expect(asymptoticConfidence(0, 10)).toBe(0);
  });

  it('approaches but never reaches 1 (mathematically — see float-precision note below)', () => {
    // At samples/k ~= 30, e^-30 (~9.4e-14) is still representable as a
    // distinguishable gap from 1 in float64. Pushed much further (e.g.
    // samples=1_000_000, k=10) the true gap underflows below float64's
    // ~1e-16 relative precision and 1-e^(-x) rounds to exactly 1.0 — a
    // float-precision artifact of IEEE 754, not a flaw in the formula
    // itself, which is exact in real-number math. Documented as a known
    // limitation (see README "Confidence Model" section).
    expect(asymptoticConfidence(300, 10)).toBeLessThan(1);
    expect(asymptoticConfidence(300, 10)).toBeGreaterThan(0.999999);
  });

  it('a larger k requires more samples to reach the same confidence (slower-building trust)', () => {
    const fast = asymptoticConfidence(20, 5);
    const slow = asymptoticConfidence(20, 50);
    expect(fast).toBeGreaterThan(slow);
  });

  it('rejects non-positive k', () => {
    expect(() => asymptoticConfidence(10, 0)).toThrow(RangeError);
  });
});

describe('decayConfidence', () => {
  it('leaves confidence unchanged with zero elapsed time', () => {
    expect(decayConfidence(0.8, 0, 0.05)).toBe(0.8);
  });

  it('leaves confidence unchanged when decay rate is 0', () => {
    expect(decayConfidence(0.8, 30, 0)).toBe(0.8);
  });

  it('decays gradually, never dropping to 0 or going negative', () => {
    const decayed = decayConfidence(0.8, 30, 0.01);
    expect(decayed).toBeLessThan(0.8);
    expect(decayed).toBeGreaterThan(0);
  });

  it('decays further with more elapsed time', () => {
    const after10 = decayConfidence(0.8, 10, 0.02);
    const after100 = decayConfidence(0.8, 100, 0.02);
    expect(after100).toBeLessThan(after10);
  });

  it('rejects a negative decay rate', () => {
    expect(() => decayConfidence(0.5, 10, -0.01)).toThrow(RangeError);
  });
});
