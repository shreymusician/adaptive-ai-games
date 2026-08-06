import { describe, it, expect } from 'vitest';
import { confidenceLevel, confidenceReading } from '../confidence';
import { testConfig } from './fixtures';

describe('confidenceLevel', () => {
  const config = testConfig().confidenceBuckets;

  it('buckets low/medium/high at the configured thresholds', () => {
    expect(confidenceLevel(0, config)).toBe('low');
    expect(confidenceLevel(0.39, config)).toBe('low');
    expect(confidenceLevel(0.4, config)).toBe('medium');
    expect(confidenceLevel(0.69, config)).toBe('medium');
    expect(confidenceLevel(0.7, config)).toBe('high');
    expect(confidenceLevel(1, config)).toBe('high');
  });

  it('never fabricates: confidenceReading always echoes the input value untouched', () => {
    const reading = confidenceReading(0.5432, config);
    expect(reading.value).toBe(0.5432);
    expect(reading.level).toBe('medium');
  });
});
