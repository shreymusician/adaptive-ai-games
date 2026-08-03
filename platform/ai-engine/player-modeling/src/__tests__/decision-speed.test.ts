import { describe, it, expect } from 'vitest';
import { DecisionSpeedAnalyzer } from '../analyzers/decision-speed';
import { makeDecision, makeMatch, makeRunContext, runAnalyzer } from './fixtures';

describe('DecisionSpeedAnalyzer', () => {
  it('unit: computes mean latency from context.decisionLatencyMs', () => {
    const match = makeMatch({ recentDecisions: [makeDecision({ context: { decisionLatencyMs: 100 } }), makeDecision({ context: { decisionLatencyMs: 200 } })] });
    const result = runAnalyzer(new DecisionSpeedAnalyzer(), makeRunContext({ match }));
    expect(result.entries[0].observation).toBe(150);
    expect(result.entries[0].key).toBe('decisionSpeed');
  });

  it('unit: derives latency from ts - offeredAt when decisionLatencyMs is absent', () => {
    const match = makeMatch({ recentDecisions: [makeDecision({ ts: 2000, context: { offeredAt: 1800 } })] });
    const result = runAnalyzer(new DecisionSpeedAnalyzer(), makeRunContext({ match }));
    expect(result.entries[0].observation).toBe(200);
  });

  it('boundary: no qualifying decisions yields an empty result', () => {
    const result = runAnalyzer(new DecisionSpeedAnalyzer(), makeRunContext({ match: makeMatch({ recentDecisions: [makeDecision()] }) }));
    expect(result.entries).toHaveLength(0);
    expect(result.matchConfidence).toBe(0);
  });

  it('confidence evolution: more qualifying decisions raise matchConfidence', () => {
    const few = runAnalyzer(new DecisionSpeedAnalyzer(), makeRunContext({ match: makeMatch({ recentDecisions: [makeDecision({ context: { decisionLatencyMs: 100 } })] }) }));
    const many = runAnalyzer(
      new DecisionSpeedAnalyzer(),
      makeRunContext({ match: makeMatch({ recentDecisions: Array.from({ length: 20 }, () => makeDecision({ context: { decisionLatencyMs: 100 } })) }) })
    );
    expect(many.matchConfidence).toBeGreaterThan(few.matchConfidence);
  });

  it('randomized input: mean is bounded by min/max of random latencies', () => {
    for (let trial = 0; trial < 20; trial++) {
      const samples = Array.from({ length: 3 + Math.floor(Math.random() * 8) }, () => Math.floor(Math.random() * 500));
      const decisions = samples.map((ms) => makeDecision({ context: { decisionLatencyMs: ms } }));
      const result = runAnalyzer(new DecisionSpeedAnalyzer(), makeRunContext({ match: makeMatch({ recentDecisions: decisions }) }));
      expect(result.entries[0].observation).toBeGreaterThanOrEqual(Math.min(...samples));
      expect(result.entries[0].observation).toBeLessThanOrEqual(Math.max(...samples));
    }
  });
});
