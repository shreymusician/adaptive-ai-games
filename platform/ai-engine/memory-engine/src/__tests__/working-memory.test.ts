import { describe, it, expect } from 'vitest';
import { WorkingMemoryStore } from '../working-memory-store';
import { WorkingMemoryNotFoundError } from '../errors';

const config = { maxObservations: 3, maxIdleMs: 1000 };

describe('WorkingMemoryStore lifecycle', () => {
  it('starts empty state for a new match', () => {
    const store = new WorkingMemoryStore(config);
    const state = store.start('m1', 'p1', 'g1', 1000);
    expect(state.plan).toBeNull();
    expect(state.recentObservations).toEqual([]);
    expect(state.counters).toEqual({});
    expect(state.context).toEqual({});
  });

  it('get() returns null for an unknown match', () => {
    const store = new WorkingMemoryStore(config);
    expect(store.get('nope')).toBeNull();
  });

  it('throws WorkingMemoryNotFoundError when mutating a match that was never started', () => {
    const store = new WorkingMemoryStore(config);
    expect(() => store.setPlan('nope', { focus: 'x' })).toThrow(WorkingMemoryNotFoundError);
  });

  it('setPlan stores an opaque plan object as-is', () => {
    const store = new WorkingMemoryStore(config);
    store.start('m1', 'p1', 'g1');
    store.setPlan('m1', { focus: 'healer-first', posture: 'ambush' });
    expect(store.get('m1')!.plan).toEqual({ focus: 'healer-first', posture: 'ambush' });
  });

  it('pushObservation evicts oldest entries beyond the configured ring-buffer capacity', () => {
    const store = new WorkingMemoryStore(config); // maxObservations: 3
    store.start('m1', 'p1', 'g1');
    for (let i = 0; i < 5; i++) {
      store.pushObservation('m1', { kind: 'move', payload: { i } });
    }
    const obs = store.get('m1')!.recentObservations;
    expect(obs).toHaveLength(3);
    expect(obs.map((o) => o.payload.i)).toEqual([2, 3, 4]); // oldest 0,1 evicted
  });

  it('incrementCounter accumulates and defaults delta to 1', () => {
    const store = new WorkingMemoryStore(config);
    store.start('m1', 'p1', 'g1');
    store.incrementCounter('m1', 'kills');
    store.incrementCounter('m1', 'kills');
    store.incrementCounter('m1', 'kills', 5);
    expect(store.get('m1')!.counters.kills).toBe(7);
  });

  it('setContext merges rather than replaces', () => {
    const store = new WorkingMemoryStore(config);
    store.start('m1', 'p1', 'g1');
    store.setContext('m1', { phase: 'laning' });
    store.setContext('m1', { targetId: 'bot-3' });
    expect(store.get('m1')!.context).toEqual({ phase: 'laning', targetId: 'bot-3' });
  });

  it('destroy removes the match and returns true; false if already gone', () => {
    const store = new WorkingMemoryStore(config);
    store.start('m1', 'p1', 'g1');
    expect(store.destroy('m1')).toBe(true);
    expect(store.get('m1')).toBeNull();
    expect(store.destroy('m1')).toBe(false);
  });

  it('starting the same matchId twice resets state (idempotent restart, not accumulation)', () => {
    const store = new WorkingMemoryStore(config);
    store.start('m1', 'p1', 'g1');
    store.incrementCounter('m1', 'kills', 10);
    store.start('m1', 'p1', 'g1'); // restart
    expect(store.get('m1')!.counters).toEqual({});
  });

  it('deleteExpired sweeps matches idle beyond maxIdleMs and returns their ids', () => {
    const store = new WorkingMemoryStore(config); // maxIdleMs: 1000
    store.start('stale', 'p1', 'g1', 0);
    store.start('fresh', 'p2', 'g1', 5000);
    const removed = store.deleteExpired(5000);
    expect(removed).toEqual(['stale']);
    expect(store.get('stale')).toBeNull();
    expect(store.get('fresh')).not.toBeNull();
  });

  it('deleteExpired accepts a custom maxIdleMs override', () => {
    const store = new WorkingMemoryStore(config);
    store.start('m1', 'p1', 'g1', 0);
    expect(store.deleteExpired(100, 50)).toEqual(['m1']); // 100ms idle > 50ms override
  });

  it('size() reflects the number of active matches', () => {
    const store = new WorkingMemoryStore(config);
    expect(store.size()).toBe(0);
    store.start('m1', 'p1', 'g1');
    store.start('m2', 'p2', 'g1');
    expect(store.size()).toBe(2);
    store.destroy('m1');
    expect(store.size()).toBe(1);
  });

  it('is fully isolated per match — mutating one never affects another', () => {
    const store = new WorkingMemoryStore(config);
    store.start('m1', 'p1', 'g1');
    store.start('m2', 'p2', 'g1');
    store.incrementCounter('m1', 'kills', 99);
    expect(store.get('m2')!.counters.kills).toBeUndefined();
  });
});
