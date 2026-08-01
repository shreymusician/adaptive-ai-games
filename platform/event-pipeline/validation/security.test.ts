import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { Db } from 'mongodb';
import { EventPipeline } from '../src/pipeline';
import { FakeDb } from '../src/__tests__/fake-mongo';

/**
 * Phase 3.5 platform validation — security / abuse scenarios.
 *
 * Drives the real Express app over HTTP attempting the attack classes called
 * out in the validation spec: invalid/expired/tampered tokens, malformed and
 * oversized payloads, cross-match/cross-player replay abuse, scope
 * escalation, and a weak-secret sanity check. Sandbox/iframe escape and
 * cross-plugin postMessage isolation are validated separately by the
 * sdk/host test suite (jsdom-based) — that boundary doesn't exist in this
 * Node HTTP layer to attack.
 */

function makePipeline(secret = 'security-test-secret'): EventPipeline {
  const db = new FakeDb() as unknown as Db;
  return new EventPipeline({ db, config: { matchTokenSecret: secret, rateLimitBatchPerWindow: 5, rateLimitBatchWindowMs: 60_000 } });
}

describe('Security: authentication', () => {
  let pipeline: EventPipeline;
  let app: ReturnType<EventPipeline['buildStandaloneApp']>;

  beforeEach(async () => {
    pipeline = makePipeline();
    await pipeline.initialize();
    app = pipeline.buildStandaloneApp();
  });

  it('rejects requests with no Authorization header', async () => {
    const res = await request(app).post('/api/events/batch').send({ events: [{ type: 'PlayerMoved', payload: {}, seq: 1 }] });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTHENTICATION_FAILED');
  });

  it('rejects a completely garbage bearer token', async () => {
    const res = await request(app)
      .post('/api/events/batch')
      .set('Authorization', 'Bearer complete-garbage-not-a-token')
      .send({ events: [{ type: 'PlayerMoved', payload: {}, seq: 1 }] });
    expect(res.status).toBe(401);
  });

  it('rejects a token with a tampered signature (single bit flip)', async () => {
    const token = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'ingest' });
    const [header, body, sig] = token.split('.');
    const tamperedSig = sig.slice(0, -1) + (sig.at(-1) === 'A' ? 'B' : 'A');
    const res = await request(app)
      .post('/api/events/batch')
      .set('Authorization', `Bearer ${header}.${body}.${tamperedSig}`)
      .send({ events: [{ type: 'PlayerMoved', payload: {}, seq: 1 }] });
    expect(res.status).toBe(401);
  });

  it('rejects a token with a tampered body but original signature (claims forgery)', async () => {
    const token = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'ingest' });
    const [header, , sig] = token.split('.');
    // Attacker tries to escalate scope to 'admin' by editing the claims but keeping the old signature.
    const forgedBody = Buffer.from(JSON.stringify({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'admin', iat: 0, exp: 9999999999 })).toString(
      'base64url'
    );
    const res = await request(app)
      .get('/api/events/game/g1')
      .set('Authorization', `Bearer ${header}.${forgedBody}.${sig}`);
    expect(res.status).toBe(401); // signature no longer matches the forged body
  });

  it('rejects an expired match token', async () => {
    const expiredToken = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'ingest' }, -10); // expired 10s ago
    const res = await request(app)
      .post('/api/events/batch')
      .set('Authorization', `Bearer ${expiredToken}`)
      .send({ events: [{ type: 'PlayerMoved', payload: {}, seq: 1 }] });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expired/i);
  });

  it('rejects a token signed with a different secret than the pipeline uses', async () => {
    const otherPipeline = makePipeline('a-completely-different-secret');
    const foreignToken = otherPipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'ingest' });
    const res = await request(app)
      .post('/api/events/batch')
      .set('Authorization', `Bearer ${foreignToken}`)
      .send({ events: [{ type: 'PlayerMoved', payload: {}, seq: 1 }] });
    expect(res.status).toBe(401);
  });

  it('rejects a token guessed against the well-known insecure default secret when the deployment overrides it', async () => {
    // Regression guard for the documented risk: EVENT_PIPELINE_MATCH_TOKEN_SECRET
    // defaults to 'dev-insecure-match-token-secret' (config.ts). If an operator
    // forgets to override it in production, anyone can mint their own admin
    // token. This pipeline instance *does* override it, so a token forged
    // against the well-known default must be rejected.
    const insecureDefaultPipeline = makePipeline('dev-insecure-match-token-secret');
    const forgedAdminToken = insecureDefaultPipeline.mintToken({ matchId: 'any', playerId: 'any', gameId: 'any', scope: 'admin' });
    const res = await request(app).get('/api/events/game/any').set('Authorization', `Bearer ${forgedAdminToken}`);
    expect(res.status).toBe(401);
  });
});

describe('Security: authorization / scope enforcement', () => {
  let pipeline: EventPipeline;
  let app: ReturnType<EventPipeline['buildStandaloneApp']>;

  beforeEach(async () => {
    pipeline = makePipeline();
    await pipeline.initialize();
    app = pipeline.buildStandaloneApp();
    const ingestToken = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'ingest' });
    await request(app)
      .post('/api/events/batch')
      .set('Authorization', `Bearer ${ingestToken}`)
      .send({ events: [{ type: 'MatchStarted', payload: {}, seq: 1 }] });
  });

  it('blocks a replay-scoped token from writing events (write/read separation)', async () => {
    const replayToken = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'replay' });
    const res = await request(app)
      .post('/api/events/batch')
      .set('Authorization', `Bearer ${replayToken}`)
      .send({ events: [{ type: 'PlayerMoved', payload: {}, seq: 2 }] });
    expect(res.status).toBe(403);
  });

  it('blocks an ingest-scoped token from reading events (write/read separation)', async () => {
    const ingestToken = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'ingest' });
    const res = await request(app).get('/api/events/match/m1').set('Authorization', `Bearer ${ingestToken}`);
    expect(res.status).toBe(403);
  });

  it('blocks cross-match replay: a token for match m1 cannot read match m2', async () => {
    const tokenForM1 = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'replay' });
    const res = await request(app).get('/api/events/match/m2').set('Authorization', `Bearer ${tokenForM1}`);
    expect(res.status).toBe(403);
  });

  it('blocks cross-player access: a token for p1 cannot read player p2 events', async () => {
    const tokenForP1 = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'replay' });
    const res = await request(app).get('/api/events/player/p2').set('Authorization', `Bearer ${tokenForP1}`);
    expect(res.status).toBe(403);
  });

  it('blocks non-admin tokens from game-wide queries (broad cross-player data)', async () => {
    const replayToken = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'replay' });
    const res = await request(app).get('/api/events/game/g1').set('Authorization', `Bearer ${replayToken}`);
    expect(res.status).toBe(403);
  });

  it('ignores identity fields spoofed in the request body — the token is the sole source of truth', async () => {
    const ingestToken = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'ingest' });
    const res = await request(app)
      .post('/api/events/batch')
      .set('Authorization', `Bearer ${ingestToken}`)
      .send({ matchId: 'm2', playerId: 'attacker', gameId: 'other-game', events: [{ type: 'PlayerMoved', payload: {}, seq: 2 }] });
    expect(res.status).toBe(202);
    expect(res.body.matchId).toBe('m1'); // not the spoofed 'm2'
  });
});

describe('Security: input abuse', () => {
  let pipeline: EventPipeline;
  let app: ReturnType<EventPipeline['buildStandaloneApp']>;
  let token: string;

  beforeEach(async () => {
    pipeline = makePipeline();
    pipeline = new EventPipeline({
      db: new FakeDb() as unknown as Db,
      config: { matchTokenSecret: 'security-test-secret', maxBatchPayloadBytes: 10_000, rateLimitBatchPerWindow: 3, rateLimitBatchWindowMs: 60_000 },
    });
    await pipeline.initialize();
    app = pipeline.buildStandaloneApp();
    token = pipeline.mintToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'ingest' });
  });

  it('rejects an oversized request body with 413, not a crash', async () => {
    const res = await request(app)
      .post('/api/events/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ events: [{ type: 'PlayerMoved', payload: { blob: 'x'.repeat(20_000) }, seq: 1 }] });
    expect(res.status).toBe(413);
  });

  it('rejects malformed JSON body gracefully (no stack trace leaked)', async () => {
    const res = await request(app)
      .post('/api/events/batch')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send('{not valid json');
    expect(res.status).toBeLessThan(500);
    expect(JSON.stringify(res.body)).not.toMatch(/at\s+\w+\s+\(.*:\d+:\d+\)/); // no stack frames in body
  });

  it('rejects a batch containing a prototype-pollution-shaped payload without crashing', async () => {
    const res = await request(app)
      .post('/api/events/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ events: [{ type: 'PlayerMoved', payload: { __proto__: { polluted: true }, constructor: { prototype: {} } }, seq: 1 }] });
    expect(res.status).toBeLessThan(500);
    expect(({} as any).polluted).toBeUndefined(); // global Object.prototype not polluted
  });

  it('enforces per-match rate limiting under repeated ingestion (flood / replay-abuse mitigation)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/events/batch')
        .set('Authorization', `Bearer ${token}`)
        .send({ events: [{ type: 'PlayerMoved', payload: {}, seq: i + 1 }] });
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });

  it('rate limits are keyed per-match, so one match flooding does not block another', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/events/batch')
        .set('Authorization', `Bearer ${token}`)
        .send({ events: [{ type: 'PlayerMoved', payload: {}, seq: i + 1 }] });
    }
    const otherToken = pipeline.mintToken({ matchId: 'm2', playerId: 'p2', gameId: 'g1', scope: 'ingest' });
    const res = await request(app)
      .post('/api/events/batch')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ events: [{ type: 'MatchStarted', payload: {}, seq: 1 }] });
    expect(res.status).toBe(202);
  });
});
