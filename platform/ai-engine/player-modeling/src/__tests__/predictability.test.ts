import { describe, it, expect } from 'vitest';
import { PredictabilityAnalyzer } from '../analyzers/predictability';
import { makeDecision, makeMatch, makeRunContext, runAnalyzer } from './fixtures';

describe('PredictabilityAnalyzer', () => {
  it('unit: always choosing the same action scores maximal predictability (1)', () => {
    const decisions = Array.from({ length: 5 }, () => makeDecision({ chosenAction: 'dodge' }));
    const result = runAnalyzer(new PredictabilityAnalyzer(), makeRunContext({ match: makeMatch({ recentDecisions: decisions }) }));
    expect(result.entries[0].observation).toBeCloseTo(1, 10);
  });

  it('unit: a uniform spread across actions scores minimal predictability (0)', () => {
    const decisions = ['a', 'b', 'c', 'd'].map((action) => makeDecision({ chosenAction: action }));
    const result = runAnalyzer(new PredictabilityAnalyzer(), makeRunContext({ match: makeMatch({ recentDecisions: decisions }) }));
    expect(result.entries[0].observation).toBeCloseTo(0, 10);
  });

  it('boundary: no decisions yields an empty result', () => {
    const result = runAnalyzer(new PredictabilityAnalyzer(), makeRunContext({ match: makeMatch() }));
    expect(result.entries).toHaveLength(0);
    expect(result.matchConfidence).toBe(0);
  });

  it('boundary: a single decision (one distinct action) is treated as fully predictable', () => {
    const result = runAnalyzer(new PredictabilityAnalyzer(), makeRunContext({ match: makeMatch({ recentDecisions: [makeDecision({ chosenAction: 'x' })] }) }));
    expect(result.entries[0].observation).toBe(1);
  });

  it('confidence evolution: matchConfidence rises with more decisions', () => {
    const few = runAnalyzer(new PredictabilityAnalyzer(), makeRunContext({ match: makeMatch({ recentDecisions: [makeDecision()] }) }));
    const many = runAnalyzer(new PredictabilityAnalyzer(), makeRunContext({ match: makeMatch({ recentDecisions: Array.from({ length: 25 }, () => makeDecision()) }) }));
    expect(many.matchConfidence).toBeGreaterThan(few.matchConfidence);
  });

  it('randomized input: observation always stays within [0, 1]', () => {
    const actions = ['a', 'b', 'c', 'd', 'e'];
    for (let trial = 0; trial < 20; trial++) {
      const decisions = Array.from({ length: 15 }, () => makeDecision({ chosenAction: actions[Math.floor(Math.random() * actions.length)] }));
      const result = runAnalyzer(new PredictabilityAnalyzer(), makeRunContext({ match: makeMatch({ recentDecisions: decisions }) }));
      expect(result.entries[0].observation).toBeGreaterThanOrEqual(0);
      expect(result.entries[0].observation).toBeLessThanOrEqual(1);
    }
  });
});
