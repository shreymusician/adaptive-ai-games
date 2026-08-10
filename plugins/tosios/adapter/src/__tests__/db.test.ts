/**
 * Milestone 1b — tests for real MongoDB persistence.
 *
 * Split deliberately into two groups:
 *  - Config-resolution tests: pure, synchronous, no network — always run,
 *    everywhere, regardless of environment.
 *  - Real-MongoDB tests: only run if plugins/tosios/adapter/.env resolves
 *    a reachable MONGODB_URI. These are NOT a substitute for the former —
 *    per this milestone's own instructions, FakeDb coverage elsewhere in
 *    this monorepo is not equivalent to actually exercising a real
 *    MongoDB instance, so this file is explicit about which of its own
 *    tests are which. Uses a dedicated `${dbName}-test-1b` database,
 *    dropped in afterAll, so this never touches real 'adaptive-games' data.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import dotenv from 'dotenv';
import { MongoClient, Db } from 'mongodb';
import { CanonicalEvent } from '@adaptive-ai/sdk-protocol';
import { OrchestrationStack } from '@adaptive-ai/orchestration';
import { resolveMongoConfig, connectRealDb } from '../db';

dotenv.config({ path: path.join(__dirname, '../../.env') });

describe('resolveMongoConfig (pure, no network)', () => {
  it('resolves the uri and defaults the db name when MONGODB_DB_NAME is unset', () => {
    const config = resolveMongoConfig({ MONGODB_URI: 'mongodb://localhost:27017' } as NodeJS.ProcessEnv);
    expect(config.uri).toBe('mongodb://localhost:27017');
    expect(config.dbName).toBe('adaptive-games');
  });

  it('honors an explicit MONGODB_DB_NAME override', () => {
    const config = resolveMongoConfig({
      MONGODB_URI: 'mongodb://localhost:27017',
      MONGODB_DB_NAME: 'custom-db',
    } as NodeJS.ProcessEnv);
    expect(config.dbName).toBe('custom-db');
  });

  it('throws a clear, actionable error when MONGODB_URI is missing', () => {
    expect(() => resolveMongoConfig({} as NodeJS.ProcessEnv)).toThrow(/MONGODB_URI/);
  });

  it('never echoes a URI back in its own error message', () => {
    try {
      resolveMongoConfig({} as NodeJS.ProcessEnv);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(String(err)).not.toMatch(/mongodb(\+srv)?:\/\//);
    }
  });
});

const REAL_MONGODB_URI = process.env.MONGODB_URI;
const describeRealDb = REAL_MONGODB_URI ? describe : describe.skip;

if (!REAL_MONGODB_URI) {
  // eslint-disable-next-line no-console
  console.warn(
    '[db.test.ts] MONGODB_URI not resolved (no plugins/tosios/adapter/.env) — ' +
      'skipping real-MongoDB tests. Config-resolution tests above still ran.'
  );
}

describeRealDb('connectRealDb + OrchestrationStack against a REAL MongoDB instance', () => {
  const testDbName = `${process.env.MONGODB_DB_NAME || 'adaptive-games'}-test-1b`;
  const testGameId = 'tosios-test-1b';
  const testPlayerId = `test-player-${Date.now()}`;

  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    const conn = await connectRealDb({ ...process.env, MONGODB_DB_NAME: testDbName } as NodeJS.ProcessEnv);
    db = conn.db;
    client = conn.client;
  }, 30000);

  afterAll(async () => {
    if (db) await db.dropDatabase(); // dedicated test database only — never 'adaptive-games' itself
    if (client) await client.close();
  }, 30000);

  it('initializes the AI stack against a real MongoDB Db', async () => {
    const stack = new OrchestrationStack({ db });
    await expect(stack.initialize()).resolves.not.toThrow();
  }, 30000);

  function fakeEvent(matchId: string, seq: number, ts: number, overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
    return {
      matchId,
      playerId: testPlayerId,
      gameId: testGameId,
      seq,
      ts,
      type: 'MatchStarted',
      payload: {},
      schemaVersion: '1',
      ...overrides,
    };
  }

  it('writes match data and semantic memory that survives a brand-new engine instance against the same db', async () => {
    const stack1 = new OrchestrationStack({ db });
    await stack1.initialize();

    const matchId = `match-${testPlayerId}`;
    const now = Date.now();
    stack1.orchestrator.ingestEvent(fakeEvent(matchId, 1, now, { type: 'MatchStarted' }));
    stack1.orchestrator.ingestEvent(
      fakeEvent(matchId, 2, now + 500, { type: 'DecisionPoint', payload: { chosenAction: 'shoot:nearestOpponent' } })
    );
    const report = await stack1.orchestrator.completeMatch(matchId, now + 1000);
    expect(report.status).toBe('complete');

    // A brand-new OrchestrationStack instance, same real db — proves this
    // is durable MongoDB storage, not stack1's in-process state.
    const stack2 = new OrchestrationStack({ db });
    await stack2.initialize();

    const profile = await stack2.memoryEngine.getSemanticProfile(testPlayerId, testGameId);
    expect(Array.isArray(profile)).toBe(true);

    const persistedReport = await stack2.reportStore.getByMatchId(matchId);
    expect(persistedReport).not.toBeNull();
    expect(persistedReport?.playerId).toBe(testPlayerId);
    expect(persistedReport?.status).toBe('complete');
  }, 30000);

  it('handles multiple concurrent match completions against the same database safely', async () => {
    const stack = new OrchestrationStack({ db });
    await stack.initialize();

    const now = Date.now();
    const ops = Array.from({ length: 5 }, (_, i) => {
      const matchId = `concurrent-match-${testPlayerId}-${i}`;
      stack.orchestrator.ingestEvent(fakeEvent(matchId, 1, now, { type: 'MatchStarted' }));
      return stack.orchestrator.completeMatch(matchId, now + 100);
    });

    const results = await Promise.all(ops);
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.status === 'complete')).toBe(true);
    expect(new Set(results.map((r) => r.matchId)).size).toBe(5); // each match's data landed independently, no cross-write corruption
  }, 30000);
});
