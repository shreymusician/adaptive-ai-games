import { describe, it, expect } from 'vitest';
import { PlayerConfidenceAnalyzer } from '../analyzers/player-confidence';
import { DimensionAnalyzerResult } from '../types';
import { makeDecision, makeMatch, makeRunContext, runAnalyzer } from './fixtures';

function siblingResults(decisionSpeedConfidence: number, riskToleranceConfidence: number): Map<string, DimensionAnalyzerResult> {
  return new Map([
    ['decisionSpeed', { entries: [], matchConfidence: decisionSpeedConfidence }],
    ['riskTolerance', { entries: [], matchConfidence: riskToleranceConfidence }],
  ]);
}

describe('PlayerConfidenceAnalyzer', () => {
  it('unit: falling latency + rising risk-taking over the match composes to a high observation', () => {
    const decisions = [
      makeDecision({ context: { decisionLatencyMs: 500, riskLevel: 0.2 } }),
      makeDecision({ context: { decisionLatencyMs: 400, riskLevel: 0.3 } }),
      makeDecision({ context: { decisionLatencyMs: 100, riskLevel: 0.8 } }),
      makeDecision({ context: { decisionLatencyMs: 90, riskLevel: 0.9 } }),
    ];
    const ctx = makeRunContext({ match: makeMatch({ recentDecisions: decisions }), siblingResults: siblingResults(0.9, 0.9) });
    const result = runAnalyzer(new PlayerConfidenceAnalyzer(), ctx);
    expect(result.entries[0].observation).toBeGreaterThan(0.5);
  });

  it('unit: rising latency + falling risk-taking composes to a low observation', () => {
    const decisions = [
      makeDecision({ context: { decisionLatencyMs: 100, riskLevel: 0.9 } }),
      makeDecision({ context: { decisionLatencyMs: 150, riskLevel: 0.8 } }),
      makeDecision({ context: { decisionLatencyMs: 500, riskLevel: 0.2 } }),
      makeDecision({ context: { decisionLatencyMs: 600, riskLevel: 0.1 } }),
    ];
    const ctx = makeRunContext({ match: makeMatch({ recentDecisions: decisions }), siblingResults: siblingResults(0.9, 0.9) });
    const result = runAnalyzer(new PlayerConfidenceAnalyzer(), ctx);
    expect(result.entries[0].observation).toBeLessThan(0.5);
  });

  it("dependency gating: matchConfidence is capped by its dependencies' confidence, never exceeding it", () => {
    const decisions = Array.from({ length: 10 }, () => makeDecision({ context: { decisionLatencyMs: 100, riskLevel: 0.5 } }));
    const ctx = makeRunContext({ match: makeMatch({ recentDecisions: decisions }), siblingResults: siblingResults(0.1, 0.9) });
    const result = runAnalyzer(new PlayerConfidenceAnalyzer(), ctx);
    expect(result.matchConfidence).toBeLessThanOrEqual(0.1);
  });

  it('boundary: missing dependency results (not yet run / failed) force matchConfidence to 0', () => {
    const decisions = Array.from({ length: 10 }, () => makeDecision({ context: { decisionLatencyMs: 100, riskLevel: 0.5 } }));
    const ctx = makeRunContext({ match: makeMatch({ recentDecisions: decisions }), siblingResults: new Map() });
    const result = runAnalyzer(new PlayerConfidenceAnalyzer(), ctx);
    expect(result.matchConfidence).toBe(0);
  });

  it('boundary: insufficient within-match trend data yields an empty result', () => {
    const ctx = makeRunContext({ match: makeMatch({ recentDecisions: [makeDecision({ context: { decisionLatencyMs: 100 } })] }), siblingResults: siblingResults(0.9, 0.9) });
    const result = runAnalyzer(new PlayerConfidenceAnalyzer(), ctx);
    expect(result.entries).toHaveLength(0);
  });
});
