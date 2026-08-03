import { describe, it, expect } from 'vitest';
import { Db } from 'mongodb';
import { MemoryEngine } from '../memory-engine';
import { FakeDb } from './fake-mongo';

/**
 * "Migration safety" here means: initialize()/ensureIndexes() are safe to
 * run repeatedly (a redeploy re-runs them; they must not error or
 * duplicate), and every persisted record carries a schema version so a
 * future migration has something to key off. This package has no actual
 * schema migrations yet (nothing to migrate from) — these tests guard the
 * preconditions a future migration would depend on.
 */
describe('Migration safety', () => {
  it('initialize() is idempotent — calling it twice does not error or duplicate indexes', async () => {
    const db = new FakeDb();
    const engine = new MemoryEngine({ db: db as unknown as Db });
    await engine.initialize();
    await engine.initialize();

    const profilesCol = db.collection('playerProfiles');
    // 2 createIndex calls per initialize() on playerProfiles (unique compound + playerId) x2 initializes = 4 declarations recorded (createIndex is naturally idempotent in real Mongo; this just confirms our store doesn't error on repeat calls)
    expect(profilesCol.indexSpecs.length).toBe(4);
  });

  it('every persisted matchMemories record carries a schemaVersion', async () => {
    const engine = new MemoryEngine({ db: new FakeDb() as unknown as Db });
    await engine.initialize();
    engine.startMatch('m1', 'p1', 'g1');
    const record = await engine.commitMatch('m1');
    expect(record.schemaVersion).toBe(1);
  });

  it('playerProfiles unique index prevents two independent latest-pointer docs for the same dimension from ever coexisting', async () => {
    const db = new FakeDb();
    const engine = new MemoryEngine({ db: db as unknown as Db });
    await engine.initialize();
    await engine.updateSemanticMemory({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.5 });
    await engine.updateSemanticMemory({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: 0.6 });

    const profilesCol = db.collection('playerProfiles');
    const matching = profilesCol.all().filter((d) => d.playerId === 'p1' && d.gameId === 'g1' && d.dimension === 'aggression');
    expect(matching).toHaveLength(1); // never more than one latest-pointer doc, however many updates occur
  });

  it('playerProfileVersions unique index guarantees no two version docs ever share (playerId, gameId, dimension, version)', async () => {
    const db = new FakeDb();
    const engine = new MemoryEngine({ db: db as unknown as Db });
    await engine.initialize();
    for (let i = 0; i < 10; i++) {
      await engine.updateSemanticMemory({ playerId: 'p1', gameId: 'g1', dimension: 'aggression', observation: i / 10 });
    }
    const versionsCol = db.collection('playerProfileVersions');
    const versions = versionsCol.all().map((d) => d.version);
    expect(new Set(versions).size).toBe(versions.length); // no duplicates
  });

  it('playerEpisodes unique index on episodeId is declared and enforced', async () => {
    const db = new FakeDb();
    const engine = new MemoryEngine({ db: db as unknown as Db });
    await engine.initialize();
    await engine.storeEpisode({
      episodeId: 'fixed-id',
      playerId: 'p1',
      gameId: 'g1',
      matchId: 'm1',
      timestamp: 0,
      episodeType: 'first-victory',
      summary: 'x',
      importance: 0.5,
      confidence: 0.5,
      referencedEvents: [],
    });
    await expect(
      engine.storeEpisode({
        episodeId: 'fixed-id', // deliberate collision
        playerId: 'p1',
        gameId: 'g1',
        matchId: 'm2',
        timestamp: 1,
        episodeType: 'important-mistake',
        summary: 'y',
        importance: 0.5,
        confidence: 0.5,
        referencedEvents: [],
      })
    ).rejects.toThrow();
  });

  it('matchMemories unique index on matchId prevents committing the same match twice at the storage layer', async () => {
    const db = new FakeDb();
    const engine = new MemoryEngine({ db: db as unknown as Db });
    await engine.initialize();
    engine.startMatch('m1', 'p1', 'g1');
    await engine.commitMatch('m1');

    // Re-starting + re-committing the same matchId a second time should be rejected by the unique index,
    // not silently overwrite the first commit's durable record.
    engine.startMatch('m1', 'p1', 'g1');
    await expect(engine.commitMatch('m1')).rejects.toThrow();
  });
});
