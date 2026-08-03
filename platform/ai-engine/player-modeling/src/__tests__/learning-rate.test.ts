import { describe, it, expect } from 'vitest';
import { SemanticDimensionVersion } from '@adaptive-ai/memory-engine';
import { LearningRateAnalyzer } from '../analyzers/learning-rate';
import { makeMatch, makeRunContext, runAnalyzer } from './fixtures';

function version(dimension: string, value: number, v: number): SemanticDimensionVersion {
  return { playerId: 'player-1', gameId: 'game-1', dimension, value, confidence: 0.5, samples: v, version: v, updatedAt: v * 1000, previousVersion: v - 1 || null };
}

describe('LearningRateAnalyzer', () => {
  it('unit: an upward mechanicalSkill/strategicSkill trend produces a positive observation', () => {
    // historicalSeries is most-recent-first.
    const historicalSeries = new Map([
      ['mechanicalSkill', [version('mechanicalSkill', 0.8, 3), version('mechanicalSkill', 0.6, 2), version('mechanicalSkill', 0.4, 1)]],
      ['strategicSkill', [version('strategicSkill', 0.7, 3), version('strategicSkill', 0.5, 2), version('strategicSkill', 0.3, 1)]],
    ]);
    const result = runAnalyzer(new LearningRateAnalyzer(), makeRunContext({ match: makeMatch(), historicalSeries }));
    expect(result.entries[0].observation).toBeGreaterThan(0);
  });

  it('unit: a downward trend produces a negative observation', () => {
    const historicalSeries = new Map([['mechanicalSkill', [version('mechanicalSkill', 0.2, 3), version('mechanicalSkill', 0.5, 2), version('mechanicalSkill', 0.8, 1)]]]);
    const result = runAnalyzer(new LearningRateAnalyzer(), makeRunContext({ match: makeMatch(), historicalSeries }));
    expect(result.entries[0].observation).toBeLessThan(0);
  });

  it('boundary: no history at all yields an empty result', () => {
    const result = runAnalyzer(new LearningRateAnalyzer(), makeRunContext({ match: makeMatch(), historicalSeries: new Map() }));
    expect(result.entries).toHaveLength(0);
    expect(result.matchConfidence).toBe(0);
  });

  it('boundary: a single version per dependency (no slope computable) yields an empty result', () => {
    const historicalSeries = new Map([['mechanicalSkill', [version('mechanicalSkill', 0.5, 1)]]]);
    const result = runAnalyzer(new LearningRateAnalyzer(), makeRunContext({ match: makeMatch(), historicalSeries }));
    expect(result.entries).toHaveLength(0);
  });

  it('historical progression: a long, steadily improving history produces a stable positive slope', () => {
    // Most-recent-first, steady +0.02 per version step.
    const series = Array.from({ length: 20 }, (_, i) => version('mechanicalSkill', (19 - i) * 0.02, 20 - i));
    const historicalSeries = new Map([['mechanicalSkill', series]]);
    const result = runAnalyzer(new LearningRateAnalyzer(), makeRunContext({ match: makeMatch(), historicalSeries }));
    expect(result.entries[0].observation).toBeCloseTo(0.02, 5);
  });
});
