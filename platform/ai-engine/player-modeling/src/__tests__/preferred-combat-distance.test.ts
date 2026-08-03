import { describe, it, expect } from 'vitest';
import { PreferredCombatDistanceAnalyzer } from '../analyzers/preferred-combat-distance';
import { makeEvent, makeMatch, makeRunContext, runAnalyzer } from './fixtures';

describe('PreferredCombatDistanceAnalyzer (categorical)', () => {
  it('unit: buckets distances into close/mid/long per settings.combatDistanceBuckets', () => {
    const events = [
      makeEvent({ type: 'PlayerDamaged', payload: { distance: 2 } }), // close (<=5)
      makeEvent({ type: 'PlayerDamaged', payload: { distance: 10 } }), // mid (<=20)
      makeEvent({ type: 'PlayerMoved', payload: { distance: 30 } }), // long (>20)
    ];
    const result = runAnalyzer(new PreferredCombatDistanceAnalyzer(), makeRunContext({ match: makeMatch() }), events);
    const keys = result.entries.map((e) => e.key).sort();
    expect(keys).toEqual(['preferredCombatDistance:close', 'preferredCombatDistance:long', 'preferredCombatDistance:mid']);
    for (const entry of result.entries) expect(entry.observation).toBeCloseTo(1 / 3, 10);
  });

  it('unit: a dominant bucket produces a higher share for that category', () => {
    const events = [
      ...Array.from({ length: 4 }, () => makeEvent({ type: 'PlayerDamaged', payload: { distance: 2 } })),
      makeEvent({ type: 'PlayerDamaged', payload: { distance: 30 } }),
    ];
    const result = runAnalyzer(new PreferredCombatDistanceAnalyzer(), makeRunContext({ match: makeMatch() }), events);
    const close = result.entries.find((e) => e.key.endsWith(':close'))!;
    expect(close.observation).toBeCloseTo(0.8, 10);
  });

  it('boundary: events without a numeric distance contribute nothing', () => {
    const result = runAnalyzer(new PreferredCombatDistanceAnalyzer(), makeRunContext({ match: makeMatch() }), [makeEvent({ type: 'PlayerDamaged', payload: {} })]);
    expect(result.entries).toHaveLength(0);
    expect(result.matchConfidence).toBe(0);
  });

  it('boundary: non-distance event types are ignored', () => {
    const result = runAnalyzer(new PreferredCombatDistanceAnalyzer(), makeRunContext({ match: makeMatch() }), [makeEvent({ type: 'AbilityUsed', payload: { distance: 1 } })]);
    expect(result.entries).toHaveLength(0);
  });

  it('confidence evolution: a sharply peaked bucket distribution scores a higher matchConfidence than a flat one', () => {
    const peaked = runAnalyzer(
      new PreferredCombatDistanceAnalyzer(),
      makeRunContext({ match: makeMatch() }),
      Array.from({ length: 10 }, () => makeEvent({ type: 'PlayerDamaged', payload: { distance: 2 } }))
    );
    const flat = runAnalyzer(
      new PreferredCombatDistanceAnalyzer(),
      makeRunContext({ match: makeMatch() }),
      [2, 10, 30].map((distance) => makeEvent({ type: 'PlayerDamaged', payload: { distance } }))
    );
    expect(peaked.matchConfidence).toBeGreaterThan(flat.matchConfidence);
  });
});
