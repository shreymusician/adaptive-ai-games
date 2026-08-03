import { describe, it, expect } from 'vitest';
import { isPromotion, nextLifecycleState } from '../lifecycle';
import { PatternLifecycleThresholds } from '../types';

const thresholds: PatternLifecycleThresholds = { confirmedConfidence: 0.5, strongConfidence: 0.8, retiredConfidence: 0.15 };

describe('nextLifecycleState', () => {
  it('a brand-new record (previous=null) below confirmedConfidence starts as candidate', () => {
    expect(nextLifecycleState(null, 0.3, thresholds)).toBe('candidate');
  });

  it('a brand-new record that immediately clears confirmedConfidence is confirmed, not forced through candidate first', () => {
    expect(nextLifecycleState(null, 0.6, thresholds)).toBe('confirmed');
  });

  it('promotes candidate -> confirmed -> strong as confidence climbs', () => {
    expect(nextLifecycleState('candidate', 0.3, thresholds)).toBe('candidate');
    expect(nextLifecycleState('candidate', 0.5, thresholds)).toBe('confirmed');
    expect(nextLifecycleState('confirmed', 0.8, thresholds)).toBe('strong');
  });

  it('a confirmed/strong pattern whose confidence falls back into the middle band becomes weakening, not candidate', () => {
    expect(nextLifecycleState('strong', 0.4, thresholds)).toBe('weakening');
    expect(nextLifecycleState('confirmed', 0.3, thresholds)).toBe('weakening');
  });

  it('a never-confirmed candidate whose confidence stays in the middle band remains candidate', () => {
    expect(nextLifecycleState('candidate', 0.4, thresholds)).toBe('candidate');
  });

  it('confidence below retiredConfidence always retires the pattern, regardless of prior state', () => {
    expect(nextLifecycleState('candidate', 0.1, thresholds)).toBe('retired');
    expect(nextLifecycleState('strong', 0.1, thresholds)).toBe('retired');
    expect(nextLifecycleState('weakening', 0.1, thresholds)).toBe('retired');
  });

  it('recovery is allowed: a weakening or retired pattern can climb back to confirmed/strong', () => {
    expect(nextLifecycleState('weakening', 0.6, thresholds)).toBe('confirmed');
    expect(nextLifecycleState('retired', 0.9, thresholds)).toBe('strong');
  });

  it('boundary: confidence exactly at a threshold clears it (inclusive)', () => {
    expect(nextLifecycleState('candidate', 0.5, thresholds)).toBe('confirmed');
    expect(nextLifecycleState('confirmed', 0.8, thresholds)).toBe('strong');
    expect(nextLifecycleState('weakening', 0.15, thresholds)).toBe('weakening');
  });
});

describe('isPromotion', () => {
  it('creating a fresh candidate from nothing counts as a promotion', () => {
    expect(isPromotion(null, 'candidate')).toBe(true);
  });

  it('candidate -> confirmed is a promotion', () => {
    expect(isPromotion('candidate', 'confirmed')).toBe(true);
  });

  it('confirmed -> weakening is a demotion', () => {
    expect(isPromotion('confirmed', 'weakening')).toBe(false);
  });

  it('weakening -> confirmed (recovery) is a promotion', () => {
    expect(isPromotion('weakening', 'confirmed')).toBe(true);
  });

  it('anything -> retired is a demotion', () => {
    expect(isPromotion('strong', 'retired')).toBe(false);
  });

  it('retired -> strong (recovery) is a promotion', () => {
    expect(isPromotion('retired', 'strong')).toBe(true);
  });
});
