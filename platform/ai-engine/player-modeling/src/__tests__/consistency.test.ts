import { describe, it, expect } from 'vitest';
import { ConsistencyAnalyzer } from '../analyzers/consistency';
import { makeDecision, makeMatch, makeRunContext, runAnalyzer } from './fixtures';

describe('ConsistencyAnalyzer', () => {
  it('unit: identical latencies (zero variance) score close to 1', () => {
    const match = makeMatch({ recentDecisions: [makeDecision({ context: { decisionLatencyMs: 200 } }), makeDecision({ context: { decisionLatencyMs: 200 } })] });
    const result = runAnalyzer(new ConsistencyAnalyzer(), makeRunContext({ match }));
    expect(result.entries[0].observation).toBeCloseTo(1, 5);
  });

  it('unit: highly variable latencies score lower than consistent ones', () => {
    const consistent = makeMatch({ recentDecisions: [makeDecision({ context: { decisionLatencyMs: 200 } }), makeDecision({ context: { decisionLatencyMs: 210 } })] });
    const erratic = makeMatch({ recentDecisions: [makeDecision({ context: { decisionLatencyMs: 50 } }), makeDecision({ context: { decisionLatencyMs: 2000 } })] });
    const consistentResult = runAnalyzer(new ConsistencyAnalyzer(), makeRunContext({ match: consistent }));
    const erraticResult = runAnalyzer(new ConsistencyAnalyzer(), makeRunContext({ match: erratic }));
    expect(consistentResult.entries[0].observation).toBeGreaterThan(erraticResult.entries[0].observation);
  });

  it('boundary: fewer than 2 samples yields an empty result (variance undefined)', () => {
    const result = runAnalyzer(new ConsistencyAnalyzer(), makeRunContext({ match: makeMatch({ recentDecisions: [makeDecision({ context: { decisionLatencyMs: 200 } })] }) }));
    expect(result.entries).toHaveLength(0);
  });

  it('boundary: no decisions at all yields an empty result', () => {
    const result = runAnalyzer(new ConsistencyAnalyzer(), makeRunContext({ match: makeMatch() }));
    expect(result.entries).toHaveLength(0);
  });

  it('randomized input: observation always stays within (0, 1]', () => {
    for (let trial = 0; trial < 20; trial++) {
      const decisions = Array.from({ length: 5 }, () => makeDecision({ context: { decisionLatencyMs: Math.floor(Math.random() * 1000) } }));
      const result = runAnalyzer(new ConsistencyAnalyzer(), makeRunContext({ match: makeMatch({ recentDecisions: decisions }) }));
      expect(result.entries[0].observation).toBeGreaterThan(0);
      expect(result.entries[0].observation).toBeLessThanOrEqual(1);
    }
  });
});
