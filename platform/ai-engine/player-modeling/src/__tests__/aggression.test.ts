import { describe, it, expect } from 'vitest';
import { AggressionAnalyzer } from '../analyzers/aggression';
import { makeEvent, makeMatch, makeRunContext, runAnalyzer } from './fixtures';

describe('AggressionAnalyzer', () => {
  it('unit: offensive AbilityUsed + TargetAcquired count as offense over total action events', () => {
    const events = [
      makeEvent({ type: 'AbilityUsed', payload: { offensive: true } }),
      makeEvent({ type: 'AbilityUsed', payload: { offensive: false } }),
      makeEvent({ type: 'TargetAcquired' }),
      makeEvent({ type: 'TargetSwitched' }),
    ];
    const result = runAnalyzer(new AggressionAnalyzer(), makeRunContext({ match: makeMatch() }), events);
    // offense: AbilityUsed(offensive:true) + TargetAcquired = 2; total action events = 4
    expect(result.entries[0].observation).toBe(0.5);
  });

  it('unit: AbilityUsed with no offensive flag defaults to offensive', () => {
    const events = [makeEvent({ type: 'AbilityUsed', payload: {} })];
    const result = runAnalyzer(new AggressionAnalyzer(), makeRunContext({ match: makeMatch() }), events);
    expect(result.entries[0].observation).toBe(1);
  });

  it('boundary: non-action events are ignored entirely', () => {
    const events = [makeEvent({ type: 'PlayerMoved' }), makeEvent({ type: 'MatchStarted' })];
    const result = runAnalyzer(new AggressionAnalyzer(), makeRunContext({ match: makeMatch() }), events);
    expect(result.entries).toHaveLength(0);
  });

  it('boundary: no events at all yields an empty result', () => {
    const result = runAnalyzer(new AggressionAnalyzer(), makeRunContext({ match: makeMatch() }), []);
    expect(result.entries).toHaveLength(0);
    expect(result.matchConfidence).toBe(0);
  });

  it('confidence evolution: matchConfidence rises with more action events', () => {
    const one = runAnalyzer(new AggressionAnalyzer(), makeRunContext({ match: makeMatch() }), [makeEvent({ type: 'TargetAcquired' })]);
    const many = runAnalyzer(
      new AggressionAnalyzer(),
      makeRunContext({ match: makeMatch() }),
      Array.from({ length: 30 }, () => makeEvent({ type: 'TargetAcquired' }))
    );
    expect(many.matchConfidence).toBeGreaterThan(one.matchConfidence);
  });

  it('randomized input: observation always stays within [0, 1]', () => {
    for (let trial = 0; trial < 20; trial++) {
      const events = Array.from({ length: 20 }, () => {
        const roll = Math.random();
        if (roll < 0.4) return makeEvent({ type: 'AbilityUsed', payload: { offensive: Math.random() > 0.5 } });
        if (roll < 0.7) return makeEvent({ type: 'TargetAcquired' });
        return makeEvent({ type: 'TargetSwitched' });
      });
      const result = runAnalyzer(new AggressionAnalyzer(), makeRunContext({ match: makeMatch() }), events);
      expect(result.entries[0].observation).toBeGreaterThanOrEqual(0);
      expect(result.entries[0].observation).toBeLessThanOrEqual(1);
    }
  });
});
