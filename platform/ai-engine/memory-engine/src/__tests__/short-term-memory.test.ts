import { describe, it, expect, beforeEach } from 'vitest';
import { Db } from 'mongodb';
import { ShortTermMemoryStore } from '../short-term-memory-store';
import { ShortTermMemoryNotFoundError } from '../errors';
import { FakeDb } from './fake-mongo';

const config = { maxEvents: 3, maxBehaviors: 3, maxDecisions: 3 };

function makeStore(): ShortTermMemoryStore {
  return new ShortTermMemoryStore(new FakeDb() as unknown as Db, config);
}

describe('ShortTermMemoryStore', () => {
  let store: ShortTermMemoryStore;

  beforeEach(() => {
    store = makeStore();
  });

  it('accumulates events/behaviors/decisions/statistics in-process, bounded per config', () => {
    store.start('m1', 'p1', 'g1', 1000);
    for (let i = 0; i < 5; i++) {
      store.recordEvent('m1', { ts: i, type: 'PlayerMoved', payload: { i } });
      store.recordBehavior('m1', { ts: i, dimension: 'aggression', value: i / 10 });
      store.recordDecision('m1', { ts: i, chosenAction: `action-${i}` });
    }
    store.incrementStatistic('m1', 'kills', 3);
    store.incrementStatistic('m1', 'kills', 2);

    const state = store.get('m1')!;
    expect(state.recentEvents).toHaveLength(3);
    expect(state.recentEvents.map((e) => e.payload.i)).toEqual([2, 3, 4]);
    expect(state.recentBehaviors).toHaveLength(3);
    expect(state.recentDecisions).toHaveLength(3);
    expect(state.statistics.kills).toBe(5);
  });

  it('throws ShortTermMemoryNotFoundError for an unstarted match', () => {
    expect(() => store.recordEvent('nope', { ts: 0, type: 'x', payload: {} })).toThrow(ShortTermMemoryNotFoundError);
  });

  it('commit persists a MatchMemoryRecord and drops the in-process copy', async () => {
    store.start('m1', 'p1', 'g1', 1000);
    store.recordEvent('m1', { ts: 1500, type: 'MatchStarted', payload: {} });
    store.incrementStatistic('m1', 'kills', 1);

    const record = await store.commit('m1', 2000, 'won 3-1');
    expect(record.matchId).toBe('m1');
    expect(record.durationMs).toBe(1000);
    expect(record.summary).toBe('won 3-1');
    expect(record.statistics.kills).toBe(1);
    expect(store.get('m1')).toBeNull(); // in-process state dropped after commit
  });

  it('commit throws for a match with no accumulated state', async () => {
    await expect(store.commit('never-started')).rejects.toThrow(ShortTermMemoryNotFoundError);
  });

  it('getByMatchId retrieves a committed record from storage', async () => {
    store.start('m1', 'p1', 'g1');
    await store.commit('m1');
    const found = await store.getByMatchId('m1');
    expect(found).not.toBeNull();
    expect(found!.matchId).toBe('m1');
  });

  it('getByMatchId returns null for a match that was never committed', async () => {
    expect(await store.getByMatchId('nope')).toBeNull();
  });

  it('getRecentForPlayer returns committed matches, most recent first, bounded by limit', async () => {
    for (let i = 0; i < 5; i++) {
      store.start(`m${i}`, 'p1', 'g1', i * 1000);
      await store.commit(`m${i}`, i * 1000 + 500);
    }
    const recent = await store.getRecentForPlayer('p1', 3);
    expect(recent).toHaveLength(3);
    expect(recent.map((r) => r.matchId)).toEqual(['m4', 'm3', 'm2']);
  });

  it('discard drops in-process state without persisting anything (abandoned match)', async () => {
    store.start('m1', 'p1', 'g1');
    store.recordEvent('m1', { ts: 0, type: 'x', payload: {} });
    expect(store.discard('m1')).toBe(true);
    expect(store.get('m1')).toBeNull();
    expect(await store.getByMatchId('m1')).toBeNull();
  });

  it('isolates state per match', () => {
    store.start('m1', 'p1', 'g1');
    store.start('m2', 'p2', 'g1');
    store.incrementStatistic('m1', 'kills', 10);
    expect(store.get('m2')!.statistics.kills).toBeUndefined();
  });

  it('size() reflects uncommitted in-process matches only', async () => {
    store.start('m1', 'p1', 'g1');
    store.start('m2', 'p2', 'g1');
    expect(store.size()).toBe(2);
    await store.commit('m1');
    expect(store.size()).toBe(1);
  });
});
