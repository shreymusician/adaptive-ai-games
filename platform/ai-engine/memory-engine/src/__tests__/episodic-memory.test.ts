import { describe, it, expect, beforeEach } from 'vitest';
import { Db } from 'mongodb';
import { EpisodicMemoryStore } from '../episodic-memory-store';
import { InvalidEpisodeError } from '../errors';
import { FakeDb } from './fake-mongo';
import { StoreEpisodeInput } from '../types';

function makeEpisode(overrides: Partial<StoreEpisodeInput> = {}): StoreEpisodeInput {
  return {
    playerId: 'p1',
    gameId: 'g1',
    matchId: 'm1',
    timestamp: 1000,
    episodeType: 'first-victory',
    summary: 'Won their first match after a 3-death start.',
    importance: 0.8,
    confidence: 0.9,
    referencedEvents: ['evt-1', 'evt-2'],
    ...overrides,
  };
}

function makeStore(maxEpisodesPerPlayerGame = 50, maxAgeMs?: number): { store: EpisodicMemoryStore } {
  const db = new FakeDb();
  const store = new EpisodicMemoryStore(db as unknown as Db, { maxEpisodesPerPlayerGame, maxAgeMs });
  return { store };
}

describe('EpisodicMemoryStore.store', () => {
  it('generates an episodeId and createdAt when not provided', async () => {
    const { store } = makeStore();
    await store.ensureIndexes();
    const episode = await store.store(makeEpisode());
    expect(episode.episodeId).toBeTruthy();
    expect(episode.createdAt).toBeGreaterThan(0);
  });

  it('preserves a caller-provided episodeId', async () => {
    const { store } = makeStore();
    await store.ensureIndexes();
    const episode = await store.store(makeEpisode({ episodeId: 'ep-fixed-1' }));
    expect(episode.episodeId).toBe('ep-fixed-1');
  });

  it('rejects importance outside [0,1]', async () => {
    const { store } = makeStore();
    await expect(store.store(makeEpisode({ importance: 1.5 }))).rejects.toThrow(InvalidEpisodeError);
    await expect(store.store(makeEpisode({ importance: -0.1 }))).rejects.toThrow(InvalidEpisodeError);
  });

  it('rejects confidence outside [0,1]', async () => {
    const { store } = makeStore();
    await expect(store.store(makeEpisode({ confidence: 2 }))).rejects.toThrow(InvalidEpisodeError);
  });

  it('rejects an empty summary', async () => {
    const { store } = makeStore();
    await expect(store.store(makeEpisode({ summary: '   ' }))).rejects.toThrow(InvalidEpisodeError);
  });

  it('getById retrieves a stored episode', async () => {
    const { store } = makeStore();
    const stored = await store.store(makeEpisode());
    const found = await store.getById(stored.episodeId);
    expect(found?.summary).toBe(stored.summary);
  });
});

describe('EpisodicMemoryStore retention policy (top-K by importance)', () => {
  it('keeps only the top-K most important episodes per (playerId, gameId)', async () => {
    const { store } = makeStore(3); // cap of 3
    for (let i = 0; i < 6; i++) {
      await store.store(makeEpisode({ episodeId: `ep-${i}`, importance: i / 10, timestamp: i }));
    }
    const { episodes, total } = await store.search({ playerId: 'p1', gameId: 'g1' });
    expect(total).toBe(3);
    const importances = episodes.map((e) => e.importance).sort((a, b) => b - a);
    expect(importances).toEqual([0.5, 0.4, 0.3]); // the 3 highest-importance survive; 0.0-0.2 pruned
  });

  it('retention is scoped per (playerId, gameId) — one player/game filling up never prunes another', async () => {
    const { store } = makeStore(2);
    await store.store(makeEpisode({ episodeId: 'a1', playerId: 'p1', gameId: 'g1', importance: 0.1 }));
    await store.store(makeEpisode({ episodeId: 'a2', playerId: 'p1', gameId: 'g1', importance: 0.2 }));
    await store.store(makeEpisode({ episodeId: 'a3', playerId: 'p1', gameId: 'g1', importance: 0.3 })); // triggers pruning for p1/g1
    await store.store(makeEpisode({ episodeId: 'b1', playerId: 'p2', gameId: 'g1', importance: 0.05 }));

    const p1Episodes = await store.search({ playerId: 'p1', gameId: 'g1' });
    const p2Episodes = await store.search({ playerId: 'p2', gameId: 'g1' });
    expect(p1Episodes.total).toBe(2); // pruned down to cap
    expect(p2Episodes.total).toBe(1); // untouched by p1's pruning
  });

  it('a newly-stored low-importance episode past the cap is itself the one pruned', async () => {
    const { store } = makeStore(2);
    await store.store(makeEpisode({ episodeId: 'high-1', importance: 0.9 }));
    await store.store(makeEpisode({ episodeId: 'high-2', importance: 0.8 }));
    await store.store(makeEpisode({ episodeId: 'low', importance: 0.1 })); // should be immediately pruned back out

    const found = await store.getById('low');
    expect(found).toBeNull();
    const { total } = await store.search({ playerId: 'p1', gameId: 'g1' });
    expect(total).toBe(2);
  });
});

describe('EpisodicMemoryStore.pruneExpired (time-based retention)', () => {
  it('is a no-op when maxAgeMs is not configured', async () => {
    const { store } = makeStore(50, undefined);
    await store.store(makeEpisode({ timestamp: 0 }));
    const removed = await store.pruneExpired(1_000_000_000);
    expect(removed).toBe(0);
  });

  it('removes episodes older than maxAgeMs when configured', async () => {
    const { store } = makeStore(50, 1000); // 1000ms max age
    await store.store(makeEpisode({ episodeId: 'old', timestamp: 0 }));
    await store.store(makeEpisode({ episodeId: 'new', timestamp: 5000 }));
    const removed = await store.pruneExpired(5500); // "old" (age 5500) > maxAge 1000; "new" (age 500) is not
    expect(removed).toBe(1);
    expect(await store.getById('old')).toBeNull();
    expect(await store.getById('new')).not.toBeNull();
  });
});

describe('EpisodicMemoryStore.search', () => {
  beforeEach(() => {});

  it('filters by episodeType', async () => {
    const { store } = makeStore();
    await store.store(makeEpisode({ episodeId: 'a', episodeType: 'first-victory' }));
    await store.store(makeEpisode({ episodeId: 'b', episodeType: 'major-comeback' }));
    const { episodes } = await store.search({ playerId: 'p1', gameId: 'g1', episodeType: 'major-comeback' });
    expect(episodes.map((e) => e.episodeId)).toEqual(['b']);
  });

  it('filters by matchId', async () => {
    const { store } = makeStore();
    await store.store(makeEpisode({ episodeId: 'a', matchId: 'm1' }));
    await store.store(makeEpisode({ episodeId: 'b', matchId: 'm2' }));
    const { episodes } = await store.search({ matchId: 'm2' });
    expect(episodes.map((e) => e.episodeId)).toEqual(['b']);
  });

  it('filters by time range (fromTs/toTs)', async () => {
    const { store } = makeStore();
    await store.store(makeEpisode({ episodeId: 'a', timestamp: 100 }));
    await store.store(makeEpisode({ episodeId: 'b', timestamp: 500 }));
    await store.store(makeEpisode({ episodeId: 'c', timestamp: 900 }));
    const { episodes } = await store.search({ playerId: 'p1', gameId: 'g1', fromTs: 200, toTs: 800 });
    expect(episodes.map((e) => e.episodeId)).toEqual(['b']);
  });

  it('filters by minImportance and minConfidence', async () => {
    const { store } = makeStore();
    await store.store(makeEpisode({ episodeId: 'a', importance: 0.9, confidence: 0.9 }));
    await store.store(makeEpisode({ episodeId: 'b', importance: 0.2, confidence: 0.9 }));
    await store.store(makeEpisode({ episodeId: 'c', importance: 0.9, confidence: 0.1 }));
    const { episodes } = await store.search({ playerId: 'p1', gameId: 'g1', minImportance: 0.5, minConfidence: 0.5 });
    expect(episodes.map((e) => e.episodeId)).toEqual(['a']);
  });

  it('sorts by recent (default) or importance', async () => {
    const { store } = makeStore();
    await store.store(makeEpisode({ episodeId: 'old-important', timestamp: 100, importance: 0.9 }));
    await store.store(makeEpisode({ episodeId: 'new-unimportant', timestamp: 900, importance: 0.1 }));

    const byRecent = await store.search({ playerId: 'p1', gameId: 'g1', sortBy: 'recent' });
    expect(byRecent.episodes[0].episodeId).toBe('new-unimportant');

    const byImportance = await store.search({ playerId: 'p1', gameId: 'g1', sortBy: 'importance' });
    expect(byImportance.episodes[0].episodeId).toBe('old-important');
  });

  it('paginates with limit/offset and reports total independent of the page', async () => {
    const { store } = makeStore();
    for (let i = 0; i < 5; i++) {
      await store.store(makeEpisode({ episodeId: `ep-${i}`, timestamp: i }));
    }
    const page1 = await store.search({ playerId: 'p1', gameId: 'g1', limit: 2, offset: 0, sortBy: 'recent' });
    const page2 = await store.search({ playerId: 'p1', gameId: 'g1', limit: 2, offset: 2, sortBy: 'recent' });
    expect(page1.total).toBe(5);
    expect(page2.total).toBe(5);
    expect(page1.episodes).toHaveLength(2);
    expect(page2.episodes).toHaveLength(2);
    expect(page1.episodes.map((e) => e.episodeId)).not.toEqual(page2.episodes.map((e) => e.episodeId));
  });

  it('getTopEpisodes returns the N highest-importance episodes for a player+game', async () => {
    const { store } = makeStore();
    await store.store(makeEpisode({ episodeId: 'a', importance: 0.3 }));
    await store.store(makeEpisode({ episodeId: 'b', importance: 0.9 }));
    await store.store(makeEpisode({ episodeId: 'c', importance: 0.6 }));
    const top2 = await store.getTopEpisodes('p1', 'g1', 2);
    expect(top2.map((e) => e.episodeId)).toEqual(['b', 'c']);
  });
});
