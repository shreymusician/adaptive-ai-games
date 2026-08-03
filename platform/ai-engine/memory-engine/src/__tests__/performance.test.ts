import { describe, it, expect } from 'vitest';
import { Db } from 'mongodb';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { afterAll } from 'vitest';
import { MemoryEngine } from '../memory-engine';
import { FakeDb } from './fake-mongo';

/**
 * Performance benchmarks — same caveat as @adaptive-ai/event-pipeline's
 * stress tests: this measures the store logic's own overhead against the
 * in-memory FakeDb (see fake-mongo.ts), not real MongoDB I/O. Treat these as
 * an upper bound on application-logic throughput, not a production capacity
 * number. See README "Performance" section for the documented complexity of
 * each operation this exercises.
 */

const metricsLog: Record<string, unknown>[] = [];

afterAll(() => {
  const dir = join(__dirname, 'results');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'performance-results.json'), JSON.stringify(metricsLog, null, 2));
});

function makeEngine(): MemoryEngine {
  return new MemoryEngine({ db: new FakeDb() as unknown as Db });
}

describe('Performance: large player history', () => {
  it('applies 5,000 sequential semantic updates to one dimension in bounded time (O(1) per update, per whitepaper §12.12)', async () => {
    const engine = makeEngine();
    await engine.initialize();

    const start = Date.now();
    for (let i = 0; i < 5000; i++) {
      await engine.updateSemanticMemory({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: Math.random() });
    }
    const elapsed = Date.now() - start;
    const perUpdateMs = elapsed / 5000;
    metricsLog.push({ scenario: '5000-sequential-semantic-updates', elapsedMs: elapsed, perUpdateMs: Number(perUpdateMs.toFixed(3)) });

    const current = await engine.getSemanticProfile('p1', 'g1');
    expect(current[0].samples).toBe(5000);
    // Generous bound: whitepaper claims O(1) per update (no recompute-from-history) —
    // per-update cost should not visibly grow with history length. 5ms/update is
    // very loose headroom for this in-memory fake; a real regression (e.g.
    // someone accidentally re-scanning full history per update) would blow past it.
    expect(perUpdateMs).toBeLessThan(5);
  }, 30_000);

  it('per-update cost at history depth 2500 does not blow up catastrophically (informational, not a clean O(1) proof)', async () => {
    // IMPORTANT CAVEAT: this does NOT cleanly validate the whitepaper's O(1)
    // claim (§12.12), because FakeCollection itself is O(n) per operation —
    // findOne/find do a linear scan, and unique-index enforcement
    // (checkUniqueConstraints) scans the whole collection on every insert.
    // SemanticMemoryStore's own logic issues a constant number of
    // findOne/insertOne/updateOne calls per update regardless of history
    // depth (genuinely O(1) in call count), but each of those fake-db calls
    // gets slower as the collection grows — a real MongoDB with the declared
    // indexes would not show this growth. This test only guards against a
    // gross regression (e.g. an accidental full-history recompute stacked on
    // top of the fake's own O(n)), not a clean asymptotic proof — see
    // README "Performance" / "Known Limitations" for the honest version of
    // this claim.
    const engine = makeEngine();
    await engine.initialize();

    async function timeNextNUpdates(n: number): Promise<number> {
      const start = Date.now();
      for (let i = 0; i < n; i++) {
        await engine.updateSemanticMemory({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: Math.random() });
      }
      return Date.now() - start;
    }

    const first500 = await timeNextNUpdates(500); // history: 0 -> 500
    await timeNextNUpdates(2000); // advance history: 500 -> 2500, untimed
    const next500After2000 = await timeNextNUpdates(500); // history: 2500 -> 3000
    metricsLog.push({
      scenario: 'update-cost-at-depth-2500-vs-depth-0-informational',
      first500Ms: first500,
      next500AtDepth2500Ms: next500After2000,
      note: 'FakeDb linear-scan artifact expected here — see test comment; real Mongo with declared indexes would not show this growth',
    });

    expect(next500After2000).toBeLessThan(3000); // catches a true hang/exponential blowup, not the expected linear-fake growth
  }, 30_000);

  it('handles 2,000 episodes across many players/games with retention correctly bounding storage', async () => {
    const engine = new MemoryEngine({ db: new FakeDb() as unknown as Db, config: { episodicMemory: { maxEpisodesPerPlayerGame: 20 } } });
    await engine.initialize();

    const start = Date.now();
    for (let i = 0; i < 2000; i++) {
      await engine.storeEpisode({
        playerId: `p${i % 10}`, // 10 players
        gameId: 'g1',
        matchId: `m${i}`,
        timestamp: i,
        episodeType: 'repeated-successful-strategy',
        summary: `Episode ${i}`,
        importance: Math.random(),
        confidence: 0.5,
        referencedEvents: [],
      });
    }
    const elapsed = Date.now() - start;
    metricsLog.push({ scenario: '2000-episodes-10-players-retention-cap-20', elapsedMs: elapsed });

    for (let p = 0; p < 10; p++) {
      const { total } = await engine.searchEpisodes({ playerId: `p${p}`, gameId: 'g1' });
      expect(total).toBe(20); // retention held the cap regardless of 200 episodes/player submitted
    }
  }, 30_000);
});

describe('Performance: batch commits', () => {
  it('commits 500 matches for the same player in bounded time and getRecentForPlayer stays fast', async () => {
    const engine = makeEngine();
    await engine.initialize();

    const start = Date.now();
    for (let i = 0; i < 500; i++) {
      engine.startMatch(`m${i}`, 'p1', 'g1', i);
      await engine.commitMatch(`m${i}`, null, i + 1);
    }
    const commitElapsed = Date.now() - start;

    const readStart = Date.now();
    const recent = await engine.loadPlayerMemory('p1', 'g1', { recentMatchLimit: 10 });
    const readElapsed = Date.now() - readStart;

    metricsLog.push({ scenario: '500-match-commits', commitElapsedMs: commitElapsed, recentReadElapsedMs: readElapsed });
    expect(recent.recentMatches).toHaveLength(10);
    expect(readElapsed).toBeLessThan(500);
  }, 30_000);
});

describe('Performance: search correctness under volume', () => {
  it('search filters remain correct (not just fast) across a large, mixed dataset', async () => {
    const engine = new MemoryEngine({ db: new FakeDb() as unknown as Db, config: { episodicMemory: { maxEpisodesPerPlayerGame: 10_000 } } });
    await engine.initialize();

    const types = ['first-victory', 'major-comeback', 'repeated-trap', 'important-mistake'];
    for (let i = 0; i < 1000; i++) {
      await engine.storeEpisode({
        playerId: 'p1',
        gameId: 'g1',
        matchId: `m${i}`,
        timestamp: i,
        episodeType: types[i % types.length],
        summary: `Episode ${i}`,
        importance: (i % 100) / 100,
        confidence: 0.5,
        referencedEvents: [],
      });
    }

    const majorComebacks = await engine.searchEpisodes({ playerId: 'p1', gameId: 'g1', episodeType: 'major-comeback' });
    expect(majorComebacks.total).toBe(250); // exactly 1/4 of 1000
    expect(majorComebacks.episodes.every((e) => e.episodeType === 'major-comeback')).toBe(true);

    const highImportance = await engine.searchEpisodes({ playerId: 'p1', gameId: 'g1', minImportance: 0.9, limit: 1000 });
    expect(highImportance.episodes.every((e) => e.importance >= 0.9)).toBe(true);

    const timeWindow = await engine.searchEpisodes({ playerId: 'p1', gameId: 'g1', fromTs: 100, toTs: 199, limit: 1000 });
    expect(timeWindow.total).toBe(100);
    expect(timeWindow.episodes.every((e) => e.timestamp >= 100 && e.timestamp <= 199)).toBe(true);
  }, 30_000);
});
