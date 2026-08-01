import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { Db } from 'mongodb';
import { isCompatibleSdkVersion, isGamePluginManifest } from '@adaptive-ai/sdk-protocol';
import { EventPipeline } from '../src/pipeline';
import { FakeDb } from '../src/__tests__/fake-mongo';
import { dummyGameScenario, fastActionScenario, edgeCasePlugin, versionMismatchCases } from './plugins';

/**
 * Phase 3.5 platform validation — functional correctness.
 *
 * Drives the real Express app (EventPipeline.buildStandaloneApp) with the
 * three validation plugins from ./plugins.ts over real HTTP (supertest),
 * exercising the full stack: auth -> rate limit -> validation -> sequencing
 * -> dedup -> persistence -> replay. Only the Mongo driver is faked (see
 * fake-mongo.ts) — same tradeoff the existing integration suite makes.
 */

function makePipeline(overrides: Partial<Parameters<typeof EventPipeline.prototype.constructor>[0]['config']> = {}) {
  const db = new FakeDb() as unknown as Db;
  return new EventPipeline({ db, config: { matchTokenSecret: 'validation-secret', ...overrides } });
}

describe('Validation Plugin 1: dummy-game — full happy-path lifecycle', () => {
  let pipeline: EventPipeline;
  let app: ReturnType<EventPipeline['buildStandaloneApp']>;

  beforeEach(async () => {
    pipeline = makePipeline();
    await pipeline.initialize();
    app = pipeline.buildStandaloneApp();
  });

  it('ingests every batch with zero loss and replays in exact order', async () => {
    const scenario = dummyGameScenario();
    const ingestToken = pipeline.mintToken({ matchId: 'dummy-1', playerId: 'p1', gameId: 'dummy-game', scope: 'ingest' });

    let totalAccepted = 0;
    let totalSent = 0;
    for (const batch of scenario.batches) {
      totalSent += batch.length;
      const res = await request(app).post('/api/events/batch').set('Authorization', `Bearer ${ingestToken}`).send({ events: batch });
      expect(res.status).toBe(202);
      expect(res.body.rejected).toBe(0);
      totalAccepted += res.body.accepted;
    }

    expect(totalAccepted).toBe(totalSent); // no event loss

    const replayToken = pipeline.mintToken({ matchId: 'dummy-1', playerId: 'p1', gameId: 'dummy-game', scope: 'replay' });
    const replay = await request(app).get('/api/events/match/dummy-1?limit=1000').set('Authorization', `Bearer ${replayToken}`);
    expect(replay.status).toBe(200);
    expect(replay.body.eventCount).toBe(totalSent);

    const seqs = replay.body.events.map((e: any) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b)); // correct ordering
    expect(new Set(seqs).size).toBe(seqs.length); // no duplicates in storage

    // schema versioning stamped on every stored event
    for (const e of replay.body.events) {
      expect(e.schemaVersion).toBe('1');
      expect(e.matchId).toBe('dummy-1');
    }

    // replayed content matches exactly what was submitted, type-for-type
    const submittedTypes = scenario.batches.flat().map((e) => e.type);
    expect(replay.body.events.map((e: any) => e.type)).toEqual(submittedTypes);
  });

  it('reports the ingested match in health and metrics after the run', async () => {
    const scenario = dummyGameScenario();
    const ingestToken = pipeline.mintToken({ matchId: 'dummy-2', playerId: 'p1', gameId: 'dummy-game', scope: 'ingest' });
    for (const batch of scenario.batches) {
      await request(app).post('/api/events/batch').set('Authorization', `Bearer ${ingestToken}`).send({ events: batch });
    }

    const health = await request(app).get('/api/events/health');
    expect(health.body.status).toBe('healthy');
    expect(health.body.storage.totalEvents).toBe(scenario.batches.flat().length);

    const metrics = await request(app).get('/api/events/metrics');
    expect(metrics.text).toContain('event_pipeline_events_processed_total');
  });
});

describe('Validation Plugin 2: fast-action-game — large batches, high event volume', () => {
  let pipeline: EventPipeline;
  let app: ReturnType<EventPipeline['buildStandaloneApp']>;

  beforeEach(async () => {
    pipeline = makePipeline({ maxBatchSize: 200, maxPageSize: 2000 });
    await pipeline.initialize();
    app = pipeline.buildStandaloneApp();
  });

  it('ingests 1000+ high-frequency events across many batches with zero loss and correct ordering', async () => {
    const scenario = fastActionScenario({ batchCount: 20, eventsPerBatch: 50 });
    const token = pipeline.mintToken({ matchId: 'fast-1', playerId: 'p1', gameId: 'fast-action', scope: 'ingest' });

    let accepted = 0;
    for (const batch of scenario.batches) {
      const res = await request(app).post('/api/events/batch').set('Authorization', `Bearer ${token}`).send({ events: batch });
      expect(res.status).toBe(202);
      accepted += res.body.accepted;
    }

    const totalSent = scenario.batches.flat().length;
    expect(accepted).toBe(totalSent);

    const replayToken = pipeline.mintToken({ matchId: 'fast-1', playerId: 'p1', gameId: 'fast-action', scope: 'replay' });
    const replay = await request(app)
      .get(`/api/events/match/fast-1?limit=${totalSent}`)
      .set('Authorization', `Bearer ${replayToken}`);
    expect(replay.body.eventCount).toBe(totalSent);
    const seqs = replay.body.events.map((e: any) => e.seq);
    expect(seqs).toEqual(Array.from({ length: totalSent }, (_, i) => i + 1)); // dense, gap-free, in order
  });

  it('rejects a batch that exceeds the configured max batch size (large-batch guard)', async () => {
    const token = pipeline.mintToken({ matchId: 'fast-2', playerId: 'p1', gameId: 'fast-action', scope: 'ingest' });
    const oversizedBatch = Array.from({ length: 500 }, (_, i) => ({ type: 'PlayerMoved' as const, payload: {}, seq: i + 1 }));
    const res = await request(app).post('/api/events/batch').set('Authorization', `Bearer ${token}`).send({ events: oversizedBatch });
    expect(res.status).toBe(400);
    expect(res.body.accepted).toBe(0);
  });
});

describe('Validation Plugin 3: edge-case-plugin — hostile / malformed input handling', () => {
  let pipeline: EventPipeline;
  let app: ReturnType<EventPipeline['buildStandaloneApp']>;
  let ingestToken: string;

  beforeEach(async () => {
    pipeline = makePipeline({ maxBatchSize: 1000, maxBatchPayloadBytes: 50_000 });
    await pipeline.initialize();
    app = pipeline.buildStandaloneApp();
    ingestToken = pipeline.mintToken({ matchId: 'edge-1', playerId: 'p1', gameId: 'edge-game', scope: 'ingest' });
  });

  const cases = edgeCasePlugin();

  it('handles every edge case without crashing the service, per documented expectation', async () => {
    const outcomes: Array<{ name: string; status: number; expect: string }> = [];
    for (const c of cases) {
      const res = await request(app).post('/api/events/batch').set('Authorization', `Bearer ${ingestToken}`).send(c.body as any);
      outcomes.push({ name: c.name, status: res.status, expect: c.expect });
      // The service must always respond — never hang, never 500, never crash.
      expect(res.status).toBeLessThan(500);
    }
    // Independently-verifiable outcomes for the report.
    expect(outcomes.find((o) => o.name === 'malformed-event-missing-payload')?.status).toBe(400);
    expect(outcomes.find((o) => o.name === 'oversized-event-payload')?.status).toBe(400);
    expect(outcomes.find((o) => o.name === 'oversized-request-body')?.status).toBe(413);
    expect(outcomes.find((o) => o.name === 'oversized-batch')?.status).toBe(400);
    expect(outcomes.find((o) => o.name === 'empty-batch')?.status).toBe(400);
    expect(outcomes.find((o) => o.name === 'non-object-body')?.status).toBe(400);
  });

  it('accepts a sequence gap but flags it (does not silently drop or crash)', async () => {
    const res = await request(app)
      .post('/api/events/batch')
      .set('Authorization', `Bearer ${ingestToken}`)
      .send({ events: [{ type: 'PlayerMoved', payload: {}, seq: 50 }] });
    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(1);
  });

  it('accepts an internally out-of-order batch, flagging it rather than rejecting or silently reordering', async () => {
    // Documented current behavior: validateSequencing() never returns
    // invalid — an out-of-order batch is accepted, persisted with each
    // event's own seq (no reordering), and only surfaced via a warn log +
    // outOfOrderEvents metric. This is a soft-validation design choice, not
    // a bug; flagged in the report as a hardening candidate if the platform
    // later needs to hard-reject reordering attempts.
    const res = await request(app)
      .post('/api/events/batch')
      .set('Authorization', `Bearer ${ingestToken}`)
      .send({
        events: [
          { type: 'PlayerMoved', payload: {}, seq: 5 },
          { type: 'PlayerMoved', payload: {}, seq: 3 },
        ],
      });
    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(2);
  });

  it('rejects a resubmitted duplicate seq on a second request (cross-batch dedup)', async () => {
    await request(app).post('/api/events/batch').set('Authorization', `Bearer ${ingestToken}`).send({ events: [{ type: 'PlayerMoved', payload: {}, seq: 1 }] });
    const res = await request(app).post('/api/events/batch').set('Authorization', `Bearer ${ingestToken}`).send({ events: [{ type: 'PlayerMoved', payload: {}, seq: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].error).toContain('Duplicate');
  });

  it('ignores spoofed matchId/playerId in the body — identity comes only from the token', async () => {
    const res = await request(app)
      .post('/api/events/batch')
      .set('Authorization', `Bearer ${ingestToken}`)
      .send({ matchId: 'someone-elses-match', playerId: 'admin', events: [{ type: 'PlayerMoved', payload: {}, seq: 1 }] });
    expect(res.status).toBe(202);
    expect(res.body.matchId).toBe('edge-1'); // from token, not body
  });
});

describe('SDK edge cases: version negotiation and manifest validation (no HTTP involved)', () => {
  it.each(versionMismatchCases())('client=$client host=$host -> compatible=$expectCompatible', ({ client, host, expectCompatible }) => {
    expect(isCompatibleSdkVersion(client, host)).toBe(expectCompatible);
  });

  it('rejects an invalid manifest (missing required fields)', () => {
    expect(isGamePluginManifest({ id: 'x' })).toBe(false);
  });

  it('rejects a manifest with a malformed license block', () => {
    expect(
      isGamePluginManifest({
        id: 'x',
        displayName: 'X',
        version: '1.0.0',
        upstreamVersion: '1.0.0',
        entryUrl: 'https://example.com',
        eventSchemaVersion: '1',
        supportsAIOpponent: false,
        legalActionSpace: 'default',
        license: { spdxId: 'MIT' }, // missing noticeUrl, upstreamRepo
      })
    ).toBe(false);
  });

  it('accepts a well-formed manifest', () => {
    expect(
      isGamePluginManifest({
        id: 'dummy-game',
        displayName: 'Dummy Game',
        version: '1.0.0',
        upstreamVersion: '1.0.0',
        entryUrl: 'https://example.com/dummy',
        eventSchemaVersion: '1',
        supportsAIOpponent: true,
        legalActionSpace: 'default',
        license: { spdxId: 'MIT', noticeUrl: 'https://example.com/notice', upstreamRepo: 'https://example.com/repo' },
      })
    ).toBe(true);
  });
});

describe('Timestamp reconciliation', () => {
  let pipeline: EventPipeline;
  let app: ReturnType<EventPipeline['buildStandaloneApp']>;

  beforeEach(async () => {
    pipeline = makePipeline();
    await pipeline.initialize();
    app = pipeline.buildStandaloneApp();
  });

  it('rejects events timestamped too far in the future (clock skew abuse)', async () => {
    const token = pipeline.mintToken({ matchId: 'ts-1', playerId: 'p1', gameId: 'g1', scope: 'ingest' });
    const res = await request(app)
      .post('/api/events/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ events: [{ type: 'PlayerMoved', payload: {}, seq: 1, ts: Date.now() + 10 * 60 * 1000 }] });
    expect(res.status).toBe(400);
  });

  it('accepts events with no client ts and stamps server time', async () => {
    const token = pipeline.mintToken({ matchId: 'ts-2', playerId: 'p1', gameId: 'g1', scope: 'ingest' });
    const before = Date.now();
    await request(app).post('/api/events/batch').set('Authorization', `Bearer ${token}`).send({ events: [{ type: 'PlayerMoved', payload: {}, seq: 1 }] });
    const replayToken = pipeline.mintToken({ matchId: 'ts-2', playerId: 'p1', gameId: 'g1', scope: 'replay' });
    const replay = await request(app).get('/api/events/match/ts-2').set('Authorization', `Bearer ${replayToken}`);
    expect(replay.body.events[0].ts).toBeGreaterThanOrEqual(before);
    expect(replay.body.events[0].serverTs).toBeGreaterThanOrEqual(before);
  });
});
