import { describe, it, expect } from 'vitest';
import { MechanicalSkillAnalyzer } from '../analyzers/mechanical-skill';
import { makeEvent, makeMatch, makeRunContext, runAnalyzer } from './fixtures';

describe('MechanicalSkillAnalyzer', () => {
  it('unit: hits over attempts, with cooldown-violation attempts counted against skill', () => {
    const events = [
      makeEvent({ type: 'AbilityUsed', payload: { hit: true } }),
      makeEvent({ type: 'AbilityUsed', payload: { hit: false } }),
      makeEvent({ type: 'AbilityOnCooldownAttempt' }),
    ];
    const result = runAnalyzer(new MechanicalSkillAnalyzer(), makeRunContext({ match: makeMatch() }), events);
    // hits=1 (payload.hit!==false), attempts=3
    expect(result.entries[0].observation).toBeCloseTo(1 / 3, 10);
  });

  it('unit: AbilityUsed with no hit flag defaults to a hit', () => {
    const events = [makeEvent({ type: 'AbilityUsed', payload: {} })];
    const result = runAnalyzer(new MechanicalSkillAnalyzer(), makeRunContext({ match: makeMatch() }), events);
    expect(result.entries[0].observation).toBe(1);
  });

  it('boundary: no relevant events yields an empty result', () => {
    const result = runAnalyzer(new MechanicalSkillAnalyzer(), makeRunContext({ match: makeMatch() }), [makeEvent({ type: 'PlayerMoved' })]);
    expect(result.entries).toHaveLength(0);
  });

  it('confidence evolution: matchConfidence rises with more attempts', () => {
    const few = runAnalyzer(new MechanicalSkillAnalyzer(), makeRunContext({ match: makeMatch() }), [makeEvent({ type: 'AbilityUsed', payload: { hit: true } })]);
    const many = runAnalyzer(
      new MechanicalSkillAnalyzer(),
      makeRunContext({ match: makeMatch() }),
      Array.from({ length: 20 }, () => makeEvent({ type: 'AbilityUsed', payload: { hit: true } }))
    );
    expect(many.matchConfidence).toBeGreaterThan(few.matchConfidence);
  });

  it('randomized input: observation always in [0, 1]', () => {
    for (let trial = 0; trial < 20; trial++) {
      const events = Array.from({ length: 15 }, () =>
        Math.random() > 0.2 ? makeEvent({ type: 'AbilityUsed', payload: { hit: Math.random() > 0.5 } }) : makeEvent({ type: 'AbilityOnCooldownAttempt' })
      );
      const result = runAnalyzer(new MechanicalSkillAnalyzer(), makeRunContext({ match: makeMatch() }), events);
      expect(result.entries[0].observation).toBeGreaterThanOrEqual(0);
      expect(result.entries[0].observation).toBeLessThanOrEqual(1);
    }
  });
});
