import { describe, it, expect, beforeEach } from 'vitest';
import { Db } from 'mongodb';
import { SemanticMemoryStore } from '../semantic-memory-store';
import { SemanticVersionNotFoundError, SemanticWriteConflictError } from '../errors';
import { FakeDb } from './fake-mongo';
import { loadMemoryEngineConfig } from '../config';

function makeStore(maxRetries = 5): { store: SemanticMemoryStore; db: FakeDb } {
  const db = new FakeDb();
  const config = loadMemoryEngineConfig();
  const store = new SemanticMemoryStore(db as unknown as Db, config.confidence, maxRetries);
  return { store, db };
}

describe('SemanticMemoryStore.update', () => {
  let store: SemanticMemoryStore;

  beforeEach(async () => {
    ({ store } = makeStore());
    await store.ensureIndexes();
  });

  it('creates version 1 on the first observation for a never-seen dimension', async () => {
    const result = await store.update({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.9 });
    expect(result.version).toBe(1);
    expect(result.samples).toBe(1);
    expect(result.value).toBe(0.9); // first observation with alpha=1
  });

  it('increments version and samples on each subsequent update', async () => {
    await store.update({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.9 });
    const second = await store.update({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.1 });
    expect(second.version).toBe(2);
    expect(second.samples).toBe(2);
  });

  it('keeps distinct dimensions, games, and cross-game (null) scope fully independent', async () => {
    await store.update({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 1 });
    await store.update({ playerId: 'p1', gameId: 'g2', dimension: 'aggression', observation: 0 });
    await store.update({ playerId: 'p1', gameId: null, dimension: 'aggression', observation: 0.5 });
    await store.update({ playerId: 'p1', gameId: 'g1', dimension: 'riskTolerance', observation: 0.3 });

    const g1Agg = await store.getCurrent('p1', 'g1', 'aggression');
    const g2Agg = await store.getCurrent('p1', 'g2', 'aggression');
    const crossAgg = await store.getCurrent('p1', null, 'aggression');
    expect(g1Agg!.value).toBe(1);
    expect(g2Agg!.value).toBe(0);
    expect(crossAgg!.value).toBe(0.5);
  });

  it('uses a per-dimension k override when configured', async () => {
    const db = new FakeDb();
    const config = loadMemoryEngineConfig({ confidence: { defaultK: 10, dimensionK: { reactionTime: 100 }, alphaMin: 0.02, decayRatePerDay: 0.01 } });
    const store2 = new SemanticMemoryStore(db as unknown as Db, config.confidence, 5);
    await store2.ensureIndexes();

    // Same sample count, different k -> different confidence.
    let a = await store2.update({ playerId: 'p1', gameId: 'g1', dimension: 'reactionTime', observation: 0.5 }); // k=100
    let b = await store2.update({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.5 }); // k=10 (default)
    for (let i = 0; i < 5; i++) {
      a = await store2.update({ playerId: 'p1', gameId: 'g1', dimension: 'reactionTime', observation: 0.5 });
      b = await store2.update({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.5 });
    }
    expect(a.confidence).toBeLessThan(b.confidence); // larger k -> slower-building confidence
  });

  it('an explicit per-call k overrides both the dimension config and the default', async () => {
    const first = await store.update({ playerId: 'p1', gameId: 'g1', dimension: 'custom', observation: 0.5, k: 1000 });
    expect(first.confidence).toBeCloseTo(1 - Math.exp(-1 / 1000), 10);
  });

  it('records matchId and reason on the version history entry when provided', async () => {
    await store.update({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.7, matchId: 'm42', reason: 'match-end update' });
    const history = await store.getHistory('p1', 'g1', 'aggression');
    expect(history[0].matchId).toBe('m42');
    expect(history[0].reason).toBe('match-end update');
  });
});

describe('SemanticMemoryStore version history and rollback', () => {
  let store: SemanticMemoryStore;

  beforeEach(async () => {
    ({ store } = makeStore());
    await store.ensureIndexes();
  });

  it('never overwrites — every update adds a new immutable version, old ones remain readable', async () => {
    await store.update({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.9 });
    await store.update({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.1 });
    await store.update({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.5 });

    const history = await store.getHistory('p1', 'g1', 'aggression');
    expect(history).toHaveLength(3);
    expect(history.map((h) => h.version)).toEqual([3, 2, 1]); // sorted newest-first
    expect(history[2].value).toBe(0.9); // v1's original value is still intact
  });

  it('getHistory respects a limit', async () => {
    for (let i = 0; i < 5; i++) {
      await store.update({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: i / 10 });
    }
    const history = await store.getHistory('p1', 'g1', 'aggression', 2);
    expect(history).toHaveLength(2);
    expect(history.map((h) => h.version)).toEqual([5, 4]);
  });

  it('rollback restores a prior version as a NEW version, not a mutation of history', async () => {
    const v1 = await store.update({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.9 });
    await store.update({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.1 });

    const rolledBack = await store.rollback('p1', 'g1', 'aggression', v1.version);
    expect(rolledBack.version).toBe(3); // a NEW version, not overwriting v1 or v2
    expect(rolledBack.value).toBe(v1.value);

    const history = await store.getHistory('p1', 'g1', 'aggression');
    expect(history).toHaveLength(3); // v1 and v2 both still present
    expect(history[0].reason).toContain('rollback-to-v1');
  });

  it('rollback throws SemanticVersionNotFoundError for a version that never existed', async () => {
    await store.update({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.9 });
    await expect(store.rollback('p1', 'g1', 'aggression', 99)).rejects.toThrow(SemanticVersionNotFoundError);
  });

  it('getCurrent reflects the rolled-back value after rollback', async () => {
    const v1 = await store.update({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.9 });
    await store.update({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.1 });
    await store.rollback('p1', 'g1', 'aggression', v1.version);
    const current = await store.getCurrent('p1', 'g1', 'aggression');
    expect(current!.value).toBe(v1.value);
  });
});

describe('SemanticMemoryStore.getProfile', () => {
  let store: SemanticMemoryStore;

  beforeEach(async () => {
    ({ store } = makeStore());
    await store.ensureIndexes();
    await store.update({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.8 });
    await store.update({ playerId: 'p1', gameId: 'g2', dimension: 'aggression', observation: 0.2 });
    await store.update({ playerId: 'p1', gameId: null, dimension: 'riskTolerance', observation: 0.5 });
    await store.update({ playerId: 'p2', gameId: 'g1', dimension: 'aggression', observation: 0.1 });
  });

  it('scoped to one game returns that game\'s dimensions plus cross-game dimensions', async () => {
    const profile = await store.getProfile('p1', 'g1');
    const dims = profile.map((d) => `${d.gameId}:${d.dimension}`);
    expect(dims).toContain('g1:aggression');
    expect(dims).toContain('null:riskTolerance');
    expect(dims).not.toContain('g2:aggression');
  });

  it('unscoped (no gameId) returns every dimension for the player across every game', async () => {
    const profile = await store.getProfile('p1');
    const dims = profile.map((d) => `${d.gameId}:${d.dimension}`);
    expect(dims).toContain('g1:aggression');
    expect(dims).toContain('g2:aggression');
    expect(dims).toContain('null:riskTolerance');
  });

  it('never leaks another player\'s dimensions', async () => {
    const profile = await store.getProfile('p1');
    expect(profile.every((d) => d.playerId === 'p1')).toBe(true);
  });
});

describe('SemanticMemoryStore concurrent updates', () => {
  it('never loses an update under concurrent writes to the same dimension (CAS retry correctness)', async () => {
    const { store } = makeStore(200); // generous retry budget — many writers race in this single-process fake
    await store.ensureIndexes();

    const concurrency = 25;
    await Promise.all(
      Array.from({ length: concurrency }, (_, i) => store.update({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: i / concurrency }))
    );

    const current = await store.getCurrent('p1', 'g1', 'aggression');
    expect(current!.samples).toBe(concurrency); // every write counted — none lost to a race

    const history = await store.getHistory('p1', 'g1', 'aggression', 1000);
    expect(history).toHaveLength(concurrency); // one immutable version per write, no duplicates, no gaps
    const versions = history.map((h) => h.version).sort((a, b) => a - b);
    expect(versions).toEqual(Array.from({ length: concurrency }, (_, i) => i + 1)); // dense 1..N, no skipped/duplicated version numbers
  });

  it('throws SemanticWriteConflictError if contention exceeds the configured retry budget', async () => {
    const { store } = makeStore(1); // exactly one attempt, no retries — a genuine race must fail one side
    await store.ensureIndexes();
    const results = await Promise.allSettled([
      store.update({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.5 }),
      store.update({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.6 }),
    ]);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(SemanticWriteConflictError);
  });
});

describe('SemanticMemoryStore.decayDormantDimensions', () => {
  const oneYearMs = 365 * 24 * 60 * 60 * 1000;

  it('decays a dormant dimension\'s confidence, as a new version, samples untouched', async () => {
    const { store } = makeStore();
    await store.ensureIndexes();
    const before = await store.update({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.9 });

    const decayedCount = await store.decayDormantDimensions(before.updatedAt + oneYearMs);

    const after = await store.getCurrent('p1', 'g1', 'aggression');
    expect(decayedCount).toBe(1);
    expect(after!.confidence).toBeLessThan(before.confidence);
    expect(after!.samples).toBe(before.samples); // decay reflects staleness, not forgotten evidence
    expect(after!.version).toBe(before.version + 1); // a new version, never a mutation
  });

  it('never decays a dimension updated very recently (sweep run with the same "now" as the write)', async () => {
    const { store } = makeStore();
    await store.ensureIndexes();
    const before = await store.update({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.9 });

    const decayedCount = await store.decayDormantDimensions(before.updatedAt);

    const after = await store.getCurrent('p1', 'g1', 'aggression');
    expect(decayedCount).toBe(0);
    expect(after!.confidence).toBe(before.confidence);
    expect(after!.version).toBe(before.version);
  });

  it('confidence never goes negative or leaves [0, 1] even after a very long dormancy', async () => {
    const { store } = makeStore();
    await store.ensureIndexes();
    const before = await store.update({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.9, k: 1 }); // small k -> high starting confidence

    await store.decayDormantDimensions(before.updatedAt + 100 * oneYearMs);

    const after = await store.getCurrent('p1', 'g1', 'aggression');
    expect(after!.confidence).toBeGreaterThanOrEqual(0);
    expect(after!.confidence).toBeLessThanOrEqual(1);
  });

  it('decayRatePerDay = 0 disables decay entirely', async () => {
    const db = new FakeDb();
    const config = loadMemoryEngineConfig({ confidence: { defaultK: 10, dimensionK: {}, alphaMin: 0.02, decayRatePerDay: 0 } });
    const store = new SemanticMemoryStore(db as unknown as Db, config.confidence, 5);
    await store.ensureIndexes();
    const before = await store.update({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.9 });

    const decayedCount = await store.decayDormantDimensions(before.updatedAt + oneYearMs);

    const after = await store.getCurrent('p1', 'g1', 'aggression');
    expect(decayedCount).toBe(0);
    expect(after!.confidence).toBe(before.confidence);
  });

  it('sweeps every dimension independently, across players/games', async () => {
    const { store } = makeStore();
    await store.ensureIndexes();
    const a = await store.update({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.9 });
    const b = await store.update({ playerId: 'p2', gameId: 'g1', dimension: 'riskTolerance', observation: 0.4 });

    const decayedCount = await store.decayDormantDimensions(Math.max(a.updatedAt, b.updatedAt) + oneYearMs);

    expect(decayedCount).toBe(2);
  });
});
