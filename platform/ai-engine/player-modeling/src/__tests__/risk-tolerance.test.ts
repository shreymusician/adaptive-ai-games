import { describe, it, expect } from 'vitest';
import { RiskToleranceAnalyzer } from '../analyzers/risk-tolerance';
import { makeDecision, makeMatch, makeRunContext, runAnalyzer } from './fixtures';

describe('RiskToleranceAnalyzer', () => {
  it('unit: computes share of decisions at/above the high-risk threshold', () => {
    const match = makeMatch({
      recentDecisions: [makeDecision({ context: { riskLevel: 0.9 } }), makeDecision({ context: { riskLevel: 0.1 } }), makeDecision({ context: { riskLevel: 0.7 } })],
    });
    const result = runAnalyzer(new RiskToleranceAnalyzer(), makeRunContext({ match }));
    // default threshold 0.6 -> 2 of 3 qualify
    expect(result.entries[0].observation).toBeCloseTo(2 / 3, 10);
  });

  it('unit: honors a custom highRiskThreshold from settings', () => {
    const match = makeMatch({ recentDecisions: [makeDecision({ context: { riskLevel: 0.5 } })] });
    const ctx = makeRunContext({ match, settings: { ...makeRunContext().settings, highRiskThreshold: 0.4 } });
    const result = runAnalyzer(new RiskToleranceAnalyzer(), ctx);
    expect(result.entries[0].observation).toBe(1);
  });

  it('boundary: decisions without riskLevel contribute no evidence', () => {
    const match = makeMatch({ recentDecisions: [makeDecision({ context: {} })] });
    const result = runAnalyzer(new RiskToleranceAnalyzer(), makeRunContext({ match }));
    expect(result.entries).toHaveLength(0);
    expect(result.matchConfidence).toBe(0);
  });

  it('confidence evolution: matchConfidence increases with more risk-scored decisions', () => {
    const few = runAnalyzer(new RiskToleranceAnalyzer(), makeRunContext({ match: makeMatch({ recentDecisions: [makeDecision({ context: { riskLevel: 0.9 } })] }) }));
    const many = runAnalyzer(
      new RiskToleranceAnalyzer(),
      makeRunContext({ match: makeMatch({ recentDecisions: Array.from({ length: 15 }, () => makeDecision({ context: { riskLevel: 0.9 } })) }) })
    );
    expect(many.matchConfidence).toBeGreaterThan(few.matchConfidence);
  });

  it('randomized input: observation is always in [0, 1]', () => {
    for (let trial = 0; trial < 20; trial++) {
      const decisions = Array.from({ length: 10 }, () => makeDecision({ context: { riskLevel: Math.random() } }));
      const result = runAnalyzer(new RiskToleranceAnalyzer(), makeRunContext({ match: makeMatch({ recentDecisions: decisions }) }));
      expect(result.entries[0].observation).toBeGreaterThanOrEqual(0);
      expect(result.entries[0].observation).toBeLessThanOrEqual(1);
    }
  });
});
