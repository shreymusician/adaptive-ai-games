import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { Db } from 'mongodb';
import { EventPipeline } from '../pipeline';
import { FakeDb } from './fake-mongo';

/**
 * Full-stack integration tests: real Express app (EventPipeline.buildStandaloneApp()),
 * real router/auth/rate-limit/validation/processor code, driven entirely over
 * HTTP via supertest. Only the database layer is a fake (see fake-mongo.ts
 * for why — no reliable network for a real mongod binary in this sandbox).
 */

function makePipeline(): EventPipeline {
  const db = new FakeDb() as unknown as Db;
  return new EventPipeline({
    db,
    config: {
      matchTokenSecret: 'integration-test-secret',
      rateLimitBatchPerWindow: 5,
      rateLimitBatchWindowMs: 60_000,
      rateLimitReadPerWindow: 5,
      rateLimitReadWindowMs: 60_000,
      maxBatchSize: 10,
      maxBatchPayloadBytes: 5000,
    },
  });
}

describe('POST /api/events/batch (integration)', () => {
  let pipeline: EventPipeline;
  let app: ReturnType<EventPipeline['buildStandaloneApp']>;

  beforeEach(async () => {
    pipeline = makePipeline();
    await pipeline.initialize();
    app = pipeline.buildStandaloneApp();
  });

  it('accepts a valid batch with a valid ingest token', async () => {
    const token = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'ingest' });

    const res = await request(app)
      .post('/api/events/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ events: [{ type: 'MatchStarted', payload: {}, seq: 1 }] });

    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(1);
    expect(res.body.rejected).toBe(0);
    expect(res.body.matchId).toBe('m1');
  });

  it('rejects a request with no Authorization header', async () => {
    const res = await request(app)
      .post('/api/events/batch')
      .send({ events: [{ type: 'MatchStarted', payload: {}, seq: 1 }] });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTHENTICATION_FAILED');
  });

  it('rejects a request with a malformed bearer token', async () => {
    const res = await request(app)
      .post('/api/events/batch')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ events: [{ type: 'MatchStarted', payload: {}, seq: 1 }] });
    expect(res.status).toBe(401);
  });

  it('rejects a replay-scoped token for ingestion (insufficient scope)', async () => {
    const token = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'replay' });
    const res = await request(app)
      .post('/api/events/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ events: [{ type: 'MatchStarted', payload: {}, seq: 1 }] });
    expect(res.status).toBe(403);
  });

  it('derives matchId/playerId/gameId from the token, ignoring any spoofed values in the body', async () => {
    const token = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'ingest' });
    await request(app)
      .post('/api/events/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ matchId: 'SPOOFED', events: [{ type: 'MatchStarted', payload: {}, seq: 1 }] });

    const replayToken = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'replay' });
    const spoofedCheck = await request(app).get('/api/events/match/SPOOFED').set('Authorization', `Bearer ${replayToken}`);
    // token only authorizes match m1, so replay of "SPOOFED" is forbidden regardless
    expect(spoofedCheck.status).toBe(403);

    const real = await request(app).get('/api/events/match/m1').set('Authorization', `Bearer ${replayToken}`);
    expect(real.status).toBe(200);
    expect(real.body.eventCount).toBe(1);
  });

  it('rejects an empty events array', async () => {
    const token = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'ingest' });
    const res = await request(app).post('/api/events/batch').set('Authorization', `Bearer ${token}`).send({ events: [] });
    expect(res.status).toBe(400);
    expect(res.body.accepted).toBe(0);
  });

  it('rejects a batch exceeding maxBatchSize', async () => {
    const token = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'ingest' });
    const events = Array.from({ length: 11 }, (_, i) => ({ type: 'PlayerMoved', payload: {}, seq: i + 1 }));
    const res = await request(app).post('/api/events/batch').set('Authorization', `Bearer ${token}`).send({ events });
    expect(res.status).toBe(400);
  });

  it('rejects an oversized request body with 413', async () => {
    const token = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'ingest' });
    const bigPayload = { data: 'x'.repeat(6000) };
    const res = await request(app)
      .post('/api/events/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ events: [{ type: 'PlayerMoved', payload: bigPayload, seq: 1 }] });
    expect(res.status).toBe(413);
  });

  it('detects and rejects duplicate events across two submissions', async () => {
    const token = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'ingest' });
    await request(app)
      .post('/api/events/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ events: [{ type: 'PlayerMoved', payload: {}, seq: 1 }] });

    const res = await request(app)
      .post('/api/events/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ events: [{ type: 'PlayerMoved', payload: {}, seq: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.rejected).toBe(1);
    expect(res.body.errors[0].error).toContain('Duplicate');
  });

  it('applies per-match rate limiting on the batch endpoint', async () => {
    const token = pipeline.mintToken({ matchId: 'rl-match', playerId: 'p1', gameId: 'g1', scope: 'ingest' });
    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      const res = await request(app)
        .post('/api/events/batch')
        .set('Authorization', `Bearer ${token}`)
        .send({ events: [{ type: 'PlayerMoved', payload: {}, seq: i + 1 }] });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe('GET /api/events/match/:matchId, /player/:id, /game/:id (integration)', () => {
  let pipeline: EventPipeline;
  let app: ReturnType<EventPipeline['buildStandaloneApp']>;

  beforeEach(async () => {
    pipeline = makePipeline();
    await pipeline.initialize();
    app = pipeline.buildStandaloneApp();

    const token = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'ingest' });
    await request(app)
      .post('/api/events/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({
        events: [
          { type: 'MatchStarted', payload: {}, seq: 1 },
          { type: 'PlayerMoved', payload: { x: 1 }, seq: 2 },
          { type: 'PlayerDamaged', payload: { amount: 5 }, seq: 3 },
        ],
      });
  });

  it('returns events for the authorized match, in seq order', async () => {
    const token = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'replay' });
    const res = await request(app).get('/api/events/match/m1').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.events.map((e: any) => e.seq)).toEqual([1, 2, 3]);
  });

  it('paginates match events with limit/offset', async () => {
    const token = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'replay' });
    const res = await request(app).get('/api/events/match/m1?limit=2&offset=1').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.events.map((e: any) => e.seq)).toEqual([2, 3]);
    expect(res.body.pagination).toEqual({ limit: 2, offset: 1, total: 3 });
  });

  it('denies match access to a token scoped to a different match', async () => {
    const token = pipeline.mintToken({ matchId: 'm2', playerId: 'p1', gameId: 'g1', scope: 'replay' });
    const res = await request(app).get('/api/events/match/m1').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('returns events for the authorized player', async () => {
    const token = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'replay' });
    const res = await request(app).get('/api/events/player/p1').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.eventCount).toBe(3);
  });

  it('denies player access to a token scoped to a different player', async () => {
    const token = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'replay' });
    const res = await request(app).get('/api/events/player/someone-else').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('requires admin scope for game-wide queries', async () => {
    const replayToken = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'replay' });
    const denied = await request(app).get('/api/events/game/g1').set('Authorization', `Bearer ${replayToken}`);
    expect(denied.status).toBe(403);

    const adminToken = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'admin' });
    const allowed = await request(app).get('/api/events/game/g1').set('Authorization', `Bearer ${adminToken}`);
    expect(allowed.status).toBe(200);
    expect(allowed.body.eventCount).toBe(3);
  });
});

describe('GET /api/events/replay (integration)', () => {
  let pipeline: EventPipeline;
  let app: ReturnType<EventPipeline['buildStandaloneApp']>;

  beforeEach(async () => {
    pipeline = makePipeline();
    await pipeline.initialize();
    app = pipeline.buildStandaloneApp();

    const token = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'ingest' });
    await request(app)
      .post('/api/events/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({
        events: [
          { type: 'MatchStarted', payload: {}, seq: 1 },
          { type: 'PlayerMoved', payload: {}, seq: 2 },
          { type: 'PlayerMoved', payload: {}, seq: 3 },
          { type: 'PlayerDamaged', payload: {}, seq: 4 },
          { type: 'MatchEnded', payload: {}, seq: 5 },
        ],
      });
  });

  it('replays a sequence range within a match', async () => {
    const token = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'replay' });
    const res = await request(app).get('/api/events/replay?matchId=m1&fromSeq=2&toSeq=4').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.events.map((e: any) => e.seq)).toEqual([2, 3, 4]);
  });

  it('replays events exactly as stored, with no transformation', async () => {
    const token = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'replay' });
    const res = await request(app).get('/api/events/replay?matchId=m1&fromSeq=2&toSeq=2').set('Authorization', `Bearer ${token}`);
    expect(res.body.events[0]).toMatchObject({ type: 'PlayerMoved', seq: 2, matchId: 'm1', playerId: 'p1', gameId: 'g1' });
  });

  it('requires at least one scoping parameter', async () => {
    const token = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'replay' });
    const res = await request(app).get('/api/events/replay').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('rejects replay of an unauthorized match even with valid seq range', async () => {
    const token = pipeline.mintToken({ matchId: 'm2', playerId: 'p1', gameId: 'g1', scope: 'replay' });
    const res = await request(app).get('/api/events/replay?matchId=m1&fromSeq=1&toSeq=5').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/events/health and /api/events/metrics (integration)', () => {
  let pipeline: EventPipeline;
  let app: ReturnType<EventPipeline['buildStandaloneApp']>;

  beforeEach(async () => {
    pipeline = makePipeline();
    await pipeline.initialize();
    app = pipeline.buildStandaloneApp();
  });

  it('health endpoint requires no authentication and reports healthy on a fresh pipeline', async () => {
    const res = await request(app).get('/api/events/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.database.connected).toBe(true);
  });

  it('health endpoint reflects processed event counts after ingestion', async () => {
    const token = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'ingest' });
    await request(app)
      .post('/api/events/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ events: [{ type: 'MatchStarted', payload: {}, seq: 1 }] });

    const res = await request(app).get('/api/events/health');
    expect(res.body.storage.totalEvents).toBe(1);
    expect(res.body.pipeline.eventsProcessed).toBe(1);
  });

  it('metrics endpoint returns Prometheus-formatted text', async () => {
    const res = await request(app).get('/api/events/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('# HELP event_pipeline_events_processed_total');
  });
});
