import { describe, it, expect } from 'vitest';
import { computeAwarenessBudget } from '../difficulty-calibration';
import { AwarenessBudgetConfig } from '../config';

const config: AwarenessBudgetConfig = { newPlayerFloor: 0.2, rampMatchCount: 5 };

describe('computeAwarenessBudget', () => {
  it('gives a brand-new player exactly the floor', () => {
    expect(computeAwarenessBudget({ recentMatchCount: 0 }, config)).toBe(0.2);
  });

  it('rises as match history against this opponent increases', () => {
    const zero = computeAwarenessBudget({ recentMatchCount: 0 }, config);
    const two = computeAwarenessBudget({ recentMatchCount: 2 }, config);
    const five = computeAwarenessBudget({ recentMatchCount: 5 }, config);
    expect(two).toBeGreaterThan(zero);
    expect(five).toBeGreaterThan(two);
    expect(five).toBe(1);
  });

  it('stays within [0, 1] even past the ramp', () => {
    expect(computeAwarenessBudget({ recentMatchCount: 50 }, config)).toBe(1);
    expect(computeAwarenessBudget({ recentMatchCount: 0 }, config)).toBeGreaterThanOrEqual(0);
  });
});
