import { describe, it, expect } from 'vitest';
import { computeBehaviorEvolution } from '../behavior-evolution';
import { computeConfidenceEvolution } from '../confidence-evolution';
import { InsufficientHistoryError } from '../errors';
import { buildSemanticDimensionHistory, testConfig, PLAYER_ID } from './fixtures';

describe('computeBehaviorEvolution', () => {
  it('reports "increasing" when the value rose beyond the stable epsilon', () => {
    const history = buildSemanticDimensionHistory('aggression', [0.3, 0.5, 0.7]);
    const evolution = computeBehaviorEvolution(history, PLAYER_ID, 'aggression', 9999, testConfig());
    expect(evolution.direction).toBe('increasing');
    expect(evolution.firstValue).toBe(0.3);
    expect(evolution.lastValue).toBe(0.7);
    expect(evolution.delta).toBeCloseTo(0.4, 10);
  });

  it('reports "decreasing" when the value fell', () => {
    const history = buildSemanticDimensionHistory('panicThreshold', [0.8, 0.6, 0.4]);
    const evolution = computeBehaviorEvolution(history, PLAYER_ID, 'panicThreshold', 9999, testConfig());
    expect(evolution.direction).toBe('decreasing');
  });

  it('reports "stable" when the change is within the epsilon', () => {
    const history = buildSemanticDimensionHistory('aggression', [0.5, 0.51, 0.52]);
    const evolution = computeBehaviorEvolution(history, PLAYER_ID, 'aggression', 9999, testConfig());
    expect(evolution.direction).toBe('stable');
  });

  it('sorts by version, not array order, before computing first/last', () => {
    const history = buildSemanticDimensionHistory('aggression', [0.3, 0.5, 0.7]);
    const shuffled = [history[2], history[0], history[1]];
    const evolution = computeBehaviorEvolution(shuffled, PLAYER_ID, 'aggression', 9999, testConfig());
    expect(evolution.firstValue).toBe(0.3);
    expect(evolution.lastValue).toBe(0.7);
  });

  it('throws InsufficientHistoryError with fewer than 2 entries', () => {
    const history = buildSemanticDimensionHistory('aggression', [0.5]);
    expect(() => computeBehaviorEvolution(history, PLAYER_ID, 'aggression', 9999, testConfig())).toThrow(InsufficientHistoryError);
  });
});

describe('computeConfidenceEvolution', () => {
  it('tracks confidence growth over a pattern/dimension history', () => {
    const history = [
      { timestamp: 1000, confidence: 0.3 },
      { timestamp: 2000, confidence: 0.5 },
      { timestamp: 3000, confidence: 0.85 },
    ];
    const evolution = computeConfidenceEvolution(history, PLAYER_ID, 'pattern', 'pattern-1', 9999, testConfig());
    expect(evolution.direction).toBe('increasing');
    expect(evolution.firstConfidence.value).toBe(0.3);
    expect(evolution.lastConfidence.value).toBe(0.85);
  });

  it('throws InsufficientHistoryError with fewer than 2 entries', () => {
    expect(() => computeConfidenceEvolution([{ timestamp: 1000, confidence: 0.5 }], PLAYER_ID, 'pattern', 'pattern-1', 9999, testConfig())).toThrow(InsufficientHistoryError);
  });
});
