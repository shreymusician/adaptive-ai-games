/**
 * HTTP-level tests for POST /api/match/start (Milestone 1c) — the bridge
 * between the platform's long-lived JWT and the short-lived, HMAC-signed
 * match token TOSIOS's live Colyseus server now verifies (see
 * plugins/tosios/adapter/src/adapted-game-room.ts's onAuth).
 *
 * Mirrors dashboardAuth.test.ts's approach: a small standalone Express app
 * using the REAL authenticateToken middleware and a REAL OrchestrationStack
 * (backed by the in-memory FakeDb fixture, not a live MongoDB) so minting
 * and decoding the match token exercises the actual signing code, not a
 * fake auth implementation.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import express, { Express, Response } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Db } from 'mongodb';
import { randomUUID } from 'crypto';
import { OrchestrationStack, verifyMatchToken } from '@adaptive-ai/orchestration';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { FakeDb } from './fake-mongo';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'match-start-test-secret';

function tokenFor(userId: string, expiresIn: string | number = '7d'): string {
  return jwt.sign({ userId }, process.env.JWT_SECRET as string, { expiresIn } as jwt.SignOptions);
}

describe('POST /api/match/start', () => {
  let app: Express;
  let stack: OrchestrationStack;

  beforeAll(async () => {
    stack = new OrchestrationStack({ db: new FakeDb() as unknown as Db, eventPipelineConfig: { matchTokenSecret: 'match-start-test-token-secret' } });
    await stack.initialize();

    app = express();
    app.use(express.json());
    const router = express.Router();
    router.use(authenticateToken);
    router.post('/match/start', (req: AuthRequest, res: Response) => {
      const { gameId } = req.body as { gameId?: string };
      if (!gameId || typeof gameId !== 'string') {
        res.status(400).json({ error: 'gameId is required' });
        return;
      }
      const playerId = req.userId!;
      const matchId = randomUUID();
      const matchToken = stack.mintMatchToken({ matchId, playerId, gameId, scope: 'ingest' });
      res.json({ matchId, playerId, gameId, matchToken });
    });
    app.use('/api', router);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).post('/api/match/start').send({ gameId: 'tosios' });
    expect(res.status).toBe(401);
  });

  it('mints a match token bound to the real JWT-verified playerId', async () => {
    const res = await request(app)
      .post('/api/match/start')
      .set('Authorization', `Bearer ${tokenFor('platform-user-1')}`)
      .send({ gameId: 'tosios' });

    expect(res.status).toBe(200);
    expect(res.body.playerId).toBe('platform-user-1');
    expect(res.body.gameId).toBe('tosios');
    expect(typeof res.body.matchToken).toBe('string');

    // Decode with the REAL verifyMatchToken — proves the response's
    // matchToken actually carries the JWT-verified identity, signed, not
    // just echoed back in plaintext JSON.
    const claims = verifyMatchToken(res.body.matchToken, stack.eventPipelineConfig);
    expect(claims.playerId).toBe('platform-user-1');
    expect(claims.matchId).toBe(res.body.matchId);
    expect(claims.gameId).toBe('tosios');
    expect(claims.scope).toBe('ingest');
  });

  it('rejects a missing gameId', async () => {
    const res = await request(app)
      .post('/api/match/start')
      .set('Authorization', `Bearer ${tokenFor('platform-user-1')}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('two different platform users minting a match token never collide on playerId', async () => {
    const resA = await request(app)
      .post('/api/match/start')
      .set('Authorization', `Bearer ${tokenFor('platform-user-A')}`)
      .send({ gameId: 'tosios' });
    const resB = await request(app)
      .post('/api/match/start')
      .set('Authorization', `Bearer ${tokenFor('platform-user-B')}`)
      .send({ gameId: 'tosios' });

    expect(resA.body.playerId).toBe('platform-user-A');
    expect(resB.body.playerId).toBe('platform-user-B');
    expect(resA.body.matchId).not.toBe(resB.body.matchId);
  });
});
