import { describe, it, expect } from 'vitest';
import { StrategicSkillAnalyzer } from '../analyzers/strategic-skill';
import { makeDecision, makeMatch, makeRunContext, runAnalyzer } from './fixtures';

describe('StrategicSkillAnalyzer', () => {
  it('unit: uses per-decision favorableOutcome flags when the plugin supplies them', () => {
    const match = makeMatch({
      recentDecisions: [makeDecision({ context: { favorableOutcome: true } }), makeDecision({ context: { favorableOutcome: false } }), makeDecision({ context: { favorableOutcome: true } })],
    });
    const result = runAnalyzer(new StrategicSkillAnalyzer(), makeRunContext({ match }));
    expect(result.entries[0].observation).toBeCloseTo(2 / 3, 10);
    expect(result.metadata?.source).toBe('decision-adapter');
  });

  it('unit: falls back to match-level statistics.outcome when no decision carries favorableOutcome', () => {
    const match = makeMatch({ statistics: { outcome: 1 } });
    const result = runAnalyzer(new StrategicSkillAnalyzer(), makeRunContext({ match }));
    expect(result.entries[0].observation).toBe(1);
    expect(result.matchConfidence).toBeLessThan(0.5); // the fallback is deliberately capped low
  });

  it('boundary: neither per-decision flags nor a match outcome yields an empty result', () => {
    const result = runAnalyzer(new StrategicSkillAnalyzer(), makeRunContext({ match: makeMatch() }));
    expect(result.entries).toHaveLength(0);
    expect(result.matchConfidence).toBe(0);
  });

  it('confidence evolution: per-decision evidence out-trusts the match-outcome fallback', () => {
    const fallback = runAnalyzer(new StrategicSkillAnalyzer(), makeRunContext({ match: makeMatch({ statistics: { outcome: 1 } }) }));
    const perDecision = runAnalyzer(
      new StrategicSkillAnalyzer(),
      makeRunContext({ match: makeMatch({ recentDecisions: Array.from({ length: 10 }, () => makeDecision({ context: { favorableOutcome: true } })) }) })
    );
    expect(perDecision.matchConfidence).toBeGreaterThan(fallback.matchConfidence);
  });
});
