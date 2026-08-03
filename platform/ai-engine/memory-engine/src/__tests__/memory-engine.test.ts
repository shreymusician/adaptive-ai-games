import { describe, it, expect, beforeEach } from 'vitest';
import { Db } from 'mongodb';
import { MemoryEngine } from '../memory-engine';
import { WorkingMemoryNotFoundError, ShortTermMemoryNotFoundError } from '../errors';
import { FakeDb } from './fake-mongo';

function makeEngine(): MemoryEngine {
  const db = new FakeDb() as unknown as Db;
  return new MemoryEngine({ db, config: { episodicMemory: { maxEpisodesPerPlayerGame: 50 } } });
}

describe('MemoryEngine — match lifecycle end-to-end', () => {
  let engine: MemoryEngine;

  beforeEach(async () => {
    engine = makeEngine();
    await engine.initialize();
  });

  it('startMatch creates both working and short-term memory', () => {
    const { working } = engine.startMatch('m1', 'p1', 'g1', 1000);
    expect(working.matchId).toBe('m1');
    expect(engine.shortTermMemory.get('m1')).not.toBeNull();
  });

  it('storeWorkingMemory applies plan/observation/counter/context patches', () => {
    engine.startMatch('m1', 'p1', 'g1');
    engine.storeWorkingMemory({ matchId: 'm1', plan: { focus: 'healer-first' } });
    engine.storeWorkingMemory({ matchId: 'm1', observation: { kind: 'move', payload: { x: 1 } } });
    engine.storeWorkingMemory({ matchId: 'm1', counterIncrement: { name: 'kills', delta: 2 } });
    engine.storeWorkingMemory({ matchId: 'm1', context: { phase: 'laning' } });

    const state = engine.workingMemory.get('m1')!;
    expect(state.plan).toEqual({ focus: 'healer-first' });
    expect(state.recentObservations).toHaveLength(1);
    expect(state.counters.kills).toBe(2);
    expect(state.context.phase).toBe('laning');
  });

  it('storeWorkingMemory auto-starts a session when playerId/gameId are provided for an unknown match', () => {
    const state = engine.storeWorkingMemory({ matchId: 'm2', playerId: 'p1', gameId: 'g1', plan: { focus: 'rush' } });
    expect(state.plan).toEqual({ focus: 'rush' });
  });

  it('storeWorkingMemory throws if the match is unknown and playerId/gameId are omitted', () => {
    expect(() => engine.storeWorkingMemory({ matchId: 'unknown', plan: {} })).toThrow();
  });

  it('commitMatch persists short-term memory and destroys working memory', async () => {
    engine.startMatch('m1', 'p1', 'g1', 1000);
    engine.storeWorkingMemory({ matchId: 'm1', counterIncrement: { name: 'kills' } });

    const record = await engine.commitMatch('m1', 'won 2-0', 5000);
    expect(record.matchId).toBe('m1');
    expect(record.durationMs).toBe(4000);
    expect(record.summary).toBe('won 2-0');
    expect(engine.workingMemory.get('m1')).toBeNull(); // ephemeral, destroyed
    expect(await engine.shortTermMemory.getByMatchId('m1')).not.toBeNull(); // durable
  });

  it('commitMatch throws if the match was never started', async () => {
    await expect(engine.commitMatch('never-started')).rejects.toThrow(ShortTermMemoryNotFoundError);
  });

  it('abandonMatch discards everything without persisting', async () => {
    engine.startMatch('m1', 'p1', 'g1');
    engine.abandonMatch('m1');
    expect(engine.workingMemory.get('m1')).toBeNull();
    expect(await engine.shortTermMemory.getByMatchId('m1')).toBeNull();
  });

  it('deleteExpiredWorkingMemory sweeps idle matches (crash resilience for matches that never reach MatchEnded)', () => {
    engine.startMatch('stale', 'p1', 'g1', 0);
    engine.startMatch('fresh', 'p2', 'g1', 100_000);
    const removed = engine.deleteExpiredWorkingMemory(100_000, 1000);
    expect(removed).toEqual(['stale']);
  });
});

describe('MemoryEngine — semantic memory pass-through', () => {
  let engine: MemoryEngine;

  beforeEach(async () => {
    engine = makeEngine();
    await engine.initialize();
  });

  it('updateSemanticMemory and getSemanticProfile round-trip correctly', async () => {
    await engine.updateSemanticMemory({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.8 });
    const profile = await engine.getSemanticProfile('p1', 'g1');
    expect(profile.find((d) => d.dimension === 'aggression')?.value).toBe(0.8);
  });

  it('rollbackSemanticDimension is exposed and functions end-to-end', async () => {
    const v1 = await engine.updateSemanticMemory({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.9 });
    await engine.updateSemanticMemory({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.1 });
    const rolled = await engine.rollbackSemanticDimension('p1', 'g1', 'aggression', v1.version);
    expect(rolled.value).toBe(0.9);
  });

  it('getSemanticHistory is exposed and returns full version history', async () => {
    await engine.updateSemanticMemory({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.5 });
    await engine.updateSemanticMemory({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.6 });
    const history = await engine.getSemanticHistory('p1', 'g1', 'aggression');
    expect(history).toHaveLength(2);
  });
});

describe('MemoryEngine — episodic memory pass-through', () => {
  let engine: MemoryEngine;

  beforeEach(async () => {
    engine = makeEngine();
    await engine.initialize();
  });

  it('storeEpisode and searchEpisodes round-trip correctly', async () => {
    await engine.storeEpisode({
      playerId: 'p1',
      gameId: 'g1',
      matchId: 'm1',
      timestamp: 1000,
      episodeType: 'first-victory',
      summary: 'First win!',
      importance: 0.9,
      confidence: 0.8,
      referencedEvents: [],
    });
    const { episodes } = await engine.searchEpisodes({ playerId: 'p1', gameId: 'g1' });
    expect(episodes).toHaveLength(1);
    expect(episodes[0].episodeType).toBe('first-victory');
  });

  it('pruneExpiredEpisodes is exposed and delegates to the episodic store', async () => {
    const engine2 = new MemoryEngine({
      db: new FakeDb() as unknown as Db,
      config: { episodicMemory: { maxEpisodesPerPlayerGame: 50, maxAgeMs: 1000 } },
    });
    await engine2.initialize();
    await engine2.storeEpisode({
      playerId: 'p1',
      gameId: 'g1',
      matchId: 'm1',
      timestamp: 0,
      episodeType: 'important-mistake',
      summary: 'Old episode',
      importance: 0.5,
      confidence: 0.5,
      referencedEvents: [],
    });
    const removed = await engine2.pruneExpiredEpisodes(5000);
    expect(removed).toBe(1);
  });
});

describe('MemoryEngine.loadPlayerMemory — the aggregate "single source of truth" read', () => {
  let engine: MemoryEngine;

  beforeEach(async () => {
    engine = makeEngine();
    await engine.initialize();
  });

  it('combines semantic profile, recent matches, and top episodes into one snapshot', async () => {
    await engine.updateSemanticMemory({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.8 });
    await engine.updateSemanticMemory({ playerId: 'p1', gameId: null, dimension: 'riskTolerance', observation: 0.3 });

    engine.startMatch('m1', 'p1', 'g1', 0);
    await engine.commitMatch('m1', 'won', 1000);

    await engine.storeEpisode({
      playerId: 'p1',
      gameId: 'g1',
      matchId: 'm1',
      timestamp: 1000,
      episodeType: 'first-victory',
      summary: 'First win',
      importance: 0.9,
      confidence: 0.9,
      referencedEvents: [],
    });

    const snapshot = await engine.loadPlayerMemory('p1', 'g1');
    expect(snapshot.playerId).toBe('p1');
    expect(snapshot.gameId).toBe('g1');
    expect(snapshot.semanticProfile.map((d) => d.dimension).sort()).toEqual(['aggression', 'riskTolerance']);
    expect(snapshot.recentMatches).toHaveLength(1);
    expect(snapshot.topEpisodes).toHaveLength(1);
    expect(snapshot.loadedAt).toBeGreaterThan(0);
  });

  it('returns no episodes when gameId is omitted (episodes are inherently per-game)', async () => {
    await engine.updateSemanticMemory({ playerId: 'p1', gameId: null, dimension: 'riskTolerance', observation: 0.3 });
    const snapshot = await engine.loadPlayerMemory('p1');
    expect(snapshot.gameId).toBeNull();
    expect(snapshot.topEpisodes).toEqual([]);
  });

  it('respects recentMatchLimit and topEpisodesLimit options', async () => {
    for (let i = 0; i < 5; i++) {
      engine.startMatch(`m${i}`, 'p1', 'g1', i);
      await engine.commitMatch(`m${i}`, null, i + 1);
    }
    const snapshot = await engine.loadPlayerMemory('p1', 'g1', { recentMatchLimit: 2 });
    expect(snapshot.recentMatches).toHaveLength(2);
  });
});

describe('MemoryEngine — full realistic match flow (integration)', () => {
  it('walks a match from start through decisions to commit to persisted profile update', async () => {
    const engine = makeEngine();
    await engine.initialize();

    // Match starts
    engine.startMatch('match-1', 'player-1', 'arena-game', 0);

    // In-flight: plan set, observations pushed, short-term events/behaviors recorded
    engine.storeWorkingMemory({ matchId: 'match-1', plan: { focus: 'aggressive' } });
    engine.shortTermMemory.recordEvent('match-1', { ts: 100, type: 'PlayerDamaged', payload: { amount: 20 } });
    engine.shortTermMemory.recordBehavior('match-1', { ts: 100, dimension: 'aggression', value: 0.9 });
    engine.shortTermMemory.recordDecision('match-1', { ts: 150, chosenAction: 'attack' });
    engine.shortTermMemory.incrementStatistic('match-1', 'kills', 1);

    // Match ends
    const matchRecord = await engine.commitMatch('match-1', 'victory', 30_000);
    expect(matchRecord.statistics.kills).toBe(1);
    expect(matchRecord.recentBehaviors).toHaveLength(1);

    // Player Modeling (future phase) would now call updateSemanticMemory using
    // the committed match's behavior observations — simulated here directly.
    await engine.updateSemanticMemory({
      playerId: 'player-1',
      gameId: 'arena-game',
      dimension: 'aggression',
      observation: matchRecord.recentBehaviors[0].value,
      matchId: 'match-1',
      reason: 'post-match profile update',
    });

    // Pattern Recognition / Player Modeling (future phase) would flag a
    // notable episode — simulated here directly.
    await engine.storeEpisode({
      playerId: 'player-1',
      gameId: 'arena-game',
      matchId: 'match-1',
      timestamp: 30_000,
      episodeType: 'first-victory',
      summary: 'Won their very first match with an aggressive strategy.',
      importance: 0.95,
      confidence: 0.9,
      referencedEvents: [],
    });

    const snapshot = await engine.loadPlayerMemory('player-1', 'arena-game');
    expect(snapshot.semanticProfile[0].value).toBe(0.9);
    expect(snapshot.recentMatches[0].matchId).toBe('match-1');
    expect(snapshot.topEpisodes[0].episodeType).toBe('first-victory');
  });
});
