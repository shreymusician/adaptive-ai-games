import { describe, it, expect } from 'vitest';
import { PreferredStrategiesAnalyzer } from '../analyzers/preferred-strategies';
import { makeDecision, makeMatch, makeRunContext, runAnalyzer } from './fixtures';

describe('PreferredStrategiesAnalyzer (categorical)', () => {
  it('unit: tallies by context.strategyTag when present', () => {
    const match = makeMatch({
      recentDecisions: [makeDecision({ context: { strategyTag: 'flank' } }), makeDecision({ context: { strategyTag: 'flank' } }), makeDecision({ context: { strategyTag: 'rush' } })],
    });
    const result = runAnalyzer(new PreferredStrategiesAnalyzer(), makeRunContext({ match }));
    const flank = result.entries.find((e) => e.key.endsWith(':flank'))!;
    expect(flank.observation).toBeCloseTo(2 / 3, 10);
  });

  it('unit: falls back to chosenAction as the category when no strategyTag is supplied', () => {
    const match = makeMatch({ recentDecisions: [makeDecision({ chosenAction: 'retreat' })] });
    const result = runAnalyzer(new PreferredStrategiesAnalyzer(), makeRunContext({ match }));
    expect(result.entries[0].key).toBe('preferredStrategies:retreat');
    expect(result.entries[0].observation).toBe(1);
  });

  it('boundary: no decisions yields an empty result', () => {
    const result = runAnalyzer(new PreferredStrategiesAnalyzer(), makeRunContext({ match: makeMatch() }));
    expect(result.entries).toHaveLength(0);
    expect(result.matchConfidence).toBe(0);
  });

  it('confidence evolution: a single dominant strategy scores a higher matchConfidence than a spread of many', () => {
    const dominant = runAnalyzer(
      new PreferredStrategiesAnalyzer(),
      makeRunContext({ match: makeMatch({ recentDecisions: Array.from({ length: 10 }, () => makeDecision({ chosenAction: 'flank' })) }) })
    );
    const spread = runAnalyzer(
      new PreferredStrategiesAnalyzer(),
      makeRunContext({ match: makeMatch({ recentDecisions: ['a', 'b', 'c', 'd'].map((action) => makeDecision({ chosenAction: action })) }) })
    );
    expect(dominant.matchConfidence).toBeGreaterThan(spread.matchConfidence);
  });
});
