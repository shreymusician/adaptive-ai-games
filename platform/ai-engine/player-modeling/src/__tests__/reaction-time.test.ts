import { describe, it, expect } from 'vitest';
import { ReactionTimeAnalyzer } from '../analyzers/reaction-time';
import { makeDecision, makeMatch, makeRunContext, runAnalyzer } from './fixtures';

function analyzer(): ReactionTimeAnalyzer {
  return new ReactionTimeAnalyzer();
}

describe('ReactionTimeAnalyzer', () => {
  it('unit: computes mean reaction time from context.reactionMs', () => {
    const match = makeMatch({ recentDecisions: [makeDecision({ context: { reactionMs: 200 } }), makeDecision({ context: { reactionMs: 300 } })] });
    const result = runAnalyzer(analyzer(), makeRunContext({ match }));
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].observation).toBe(250);
    expect(result.entries[0].key).toBe('reactionTime');
  });

  it('unit: derives reaction time from ts - stimulusTs when reactionMs is absent', () => {
    const match = makeMatch({ recentDecisions: [makeDecision({ ts: 1500, context: { stimulusTs: 1200 } })] });
    const result = runAnalyzer(analyzer(), makeRunContext({ match }));
    expect(result.entries[0].observation).toBe(300);
  });

  it('boundary: no qualifying decisions produces an empty result with zero confidence', () => {
    const match = makeMatch({ recentDecisions: [makeDecision({ context: {} })] });
    const result = runAnalyzer(analyzer(), makeRunContext({ match }));
    expect(result.entries).toHaveLength(0);
    expect(result.matchConfidence).toBe(0);
  });

  it('boundary: empty match produces an empty result', () => {
    const result = runAnalyzer(analyzer(), makeRunContext({ match: makeMatch() }));
    expect(result.entries).toHaveLength(0);
  });

  it('confidence evolution: matchConfidence increases monotonically with more qualifying decisions', () => {
    const confidences: number[] = [];
    for (let n = 1; n <= 10; n++) {
      const decisions = Array.from({ length: n }, () => makeDecision({ context: { reactionMs: 200 } }));
      const result = runAnalyzer(analyzer(), makeRunContext({ match: makeMatch({ recentDecisions: decisions }) }));
      confidences.push(result.matchConfidence);
    }
    for (let i = 1; i < confidences.length; i++) {
      expect(confidences[i]).toBeGreaterThanOrEqual(confidences[i - 1]);
    }
    expect(confidences.at(-1)!).toBeLessThan(1);
  });

  it('randomized input: observation always falls within the min/max of the sampled reaction times', () => {
    for (let trial = 0; trial < 20; trial++) {
      const samples = Array.from({ length: 5 + Math.floor(Math.random() * 10) }, () => Math.floor(Math.random() * 1000));
      const decisions = samples.map((ms) => makeDecision({ context: { reactionMs: ms } }));
      const result = runAnalyzer(analyzer(), makeRunContext({ match: makeMatch({ recentDecisions: decisions }) }));
      expect(result.entries[0].observation).toBeGreaterThanOrEqual(Math.min(...samples));
      expect(result.entries[0].observation).toBeLessThanOrEqual(Math.max(...samples));
    }
  });

  it('regression: reset() clears accumulated state between runs on the same instance', () => {
    const a = analyzer();
    runAnalyzer(a, makeRunContext({ match: makeMatch({ recentDecisions: [makeDecision({ context: { reactionMs: 900 } })] }) }));
    a.reset();
    const result = runAnalyzer(a, makeRunContext({ match: makeMatch({ recentDecisions: [makeDecision({ context: { reactionMs: 100 } })] }) }));
    expect(result.entries[0].observation).toBe(100);
  });
});
