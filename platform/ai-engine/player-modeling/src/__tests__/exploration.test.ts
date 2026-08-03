import { describe, it, expect } from 'vitest';
import { ExplorationAnalyzer } from '../analyzers/exploration';
import { makeEvent, makeMatch, makeRunContext, runAnalyzer } from './fixtures';

describe('ExplorationAnalyzer', () => {
  it('unit: touching all-distinct entities scores maximal diversity (1)', () => {
    const events = ['sword', 'bow', 'shield'].map((itemId) => makeEvent({ type: 'ItemPicked', payload: { itemId } }));
    const result = runAnalyzer(new ExplorationAnalyzer(), makeRunContext({ match: makeMatch() }), events);
    expect(result.entries[0].observation).toBe(1);
  });

  it('unit: repeatedly touching the same entity scores low diversity', () => {
    const events = Array.from({ length: 5 }, () => makeEvent({ type: 'ItemPicked', payload: { itemId: 'sword' } }));
    const result = runAnalyzer(new ExplorationAnalyzer(), makeRunContext({ match: makeMatch() }), events);
    expect(result.entries[0].observation).toBe(0.2);
  });

  it('boundary: no novelty-relevant events yields an empty result', () => {
    const result = runAnalyzer(new ExplorationAnalyzer(), makeRunContext({ match: makeMatch() }), [makeEvent({ type: 'PlayerMoved' })]);
    expect(result.entries).toHaveLength(0);
  });

  it('randomized input: observation always in (0, 1]', () => {
    for (let trial = 0; trial < 20; trial++) {
      const events = Array.from({ length: 10 }, () => makeEvent({ type: 'TargetAcquired', payload: { targetId: `t${Math.floor(Math.random() * 5)}` } }));
      const result = runAnalyzer(new ExplorationAnalyzer(), makeRunContext({ match: makeMatch() }), events);
      expect(result.entries[0].observation).toBeGreaterThan(0);
      expect(result.entries[0].observation).toBeLessThanOrEqual(1);
    }
  });
});
