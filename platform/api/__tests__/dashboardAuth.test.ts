/**
 * HTTP-level tests for the dashboard authorization gate (Milestone 1a).
 *
 * Builds a small standalone Express app that mirrors the exact
 * middleware shape server.ts uses (authenticateToken + the dashboard
 * guard, then a downstream handler) — without needing a live Mongo
 * connection or the full OrchestrationStack, since neither
 * authenticateToken nor the guard middleware depend on either. The
 * downstream handlers here stand in for @adaptive-ai/orchestration's real
 * dashboardRouter handlers, which are untouched and out of scope for this
 * milestone.
 */
import { describe, it, expect } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { authenticateToken } from '../middleware/auth';
import { requireOwnPlayerId, filterMatchReportByOwner } from '../middleware/dashboardAuth';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'dashboard-auth-test-secret';

function tokenFor(userId: string, expiresIn: string | number = '7d'): string {
  return jwt.sign({ userId }, process.env.JWT_SECRET as string, { expiresIn } as jwt.SignOptions);
}

function buildTestApp(): Express {
  const app = express();
  app.use(express.json());

  // Mirrors GET /api/dashboard/players/:playerId/profile
  app.get('/api/dashboard/players/:playerId/profile', authenticateToken, requireOwnPlayerId, (req, res) => {
    res.json({ playerId: req.params.playerId, dimensions: [] });
  });

  // Mirrors GET /api/dashboard/matches/:matchId/report — a real report
  // "owner-1" and a genuinely-missing match, to exercise both the
  // ownership check and the pre-existing 404 path.
  app.get('/api/dashboard/matches/:matchId/report', authenticateToken, filterMatchReportByOwner, (req, res) => {
    if (req.params.matchId === 'missing-match') {
      res.status(404).json({ error: 'No processing report for match missing-match', code: 'NOT_FOUND' });
      return;
    }
    res.json({ matchId: req.params.matchId, playerId: 'owner-1', status: 'complete' });
  });

  return app;
}

describe('dashboard authorization gate', () => {
  const app = buildTestApp();

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/dashboard/players/owner-1/profile');
    expect(res.status).toBe(401);
  });

  it('allows an authenticated user to read their own profile', async () => {
    const res = await request(app)
      .get('/api/dashboard/players/owner-1/profile')
      .set('Authorization', `Bearer ${tokenFor('owner-1')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ playerId: 'owner-1', dimensions: [] });
  });

  it("rejects an authenticated user reading another user's profile", async () => {
    const res = await request(app)
      .get('/api/dashboard/players/owner-2/profile')
      .set('Authorization', `Bearer ${tokenFor('owner-1')}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('rejects an invalid JWT', async () => {
    const res = await request(app)
      .get('/api/dashboard/players/owner-1/profile')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('rejects an expired JWT', async () => {
    const res = await request(app)
      .get('/api/dashboard/players/owner-1/profile')
      .set('Authorization', `Bearer ${tokenFor('owner-1', '-10s')}`);
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const forged = jwt.sign({ userId: 'owner-1' }, 'a-different-secret', { expiresIn: '7d' });
    const res = await request(app)
      .get('/api/dashboard/players/owner-1/profile')
      .set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('allows an authenticated user to read their own match report', async () => {
    const res = await request(app)
      .get('/api/dashboard/matches/match-1/report')
      .set('Authorization', `Bearer ${tokenFor('owner-1')}`);
    expect(res.status).toBe(200);
    expect(res.body.matchId).toBe('match-1');
  });

  it("hides another user's match report behind the same 404 shape as a missing match", async () => {
    const otherUsersReport = await request(app)
      .get('/api/dashboard/matches/match-1/report')
      .set('Authorization', `Bearer ${tokenFor('owner-2')}`);
    const genuinelyMissing = await request(app)
      .get('/api/dashboard/matches/missing-match/report')
      .set('Authorization', `Bearer ${tokenFor('owner-2')}`);

    expect(otherUsersReport.status).toBe(404);
    expect(otherUsersReport.body.code).toBe('NOT_FOUND');
    expect(genuinelyMissing.status).toBe(404);
    expect(genuinelyMissing.body.code).toBe('NOT_FOUND');
  });
});
