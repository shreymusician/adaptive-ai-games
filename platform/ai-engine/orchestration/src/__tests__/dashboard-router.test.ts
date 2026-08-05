import { describe, it, expect, beforeEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { CanonicalEvent } from '@adaptive-ai/sdk-protocol';
import { OrchestrationStack } from '../bootstrap';
import { buildTestStack } from './test-stack';
import { buildMatchEvents } from './fixtures';

const PLAYER_ID = 'player-1';
const GAME_ID = 'game-1';

function toCanonical(matchId: string, raw: ReturnType<typeof buildMatchEvents>[number]): CanonicalEvent {
  return { matchId, playerId: PLAYER_ID, gameId: GAME_ID, seq: raw.seq, ts: raw.ts, type: raw.type as CanonicalEvent['type'], payload: raw.payload, schemaVersion: '1' };
}

async function completeAMatch(stack: OrchestrationStack, matchId: string) {
  for (const r of buildMatchEvents(Date.now())) stack.orchestrator.ingestEvent(toCanonical(matchId, r));
  return stack.orchestrator.completeMatch(matchId);
}

describe('dashboard router', () => {
  let stack: OrchestrationStack;
  let app: Express;

  beforeEach(async () => {
    stack = await buildTestStack();
    app = express();
    app.use('/api', stack.dashboardRouter);
  });

  it('GET /dashboard/players/:playerId/profile returns the aggregate snapshot', async () => {
    await completeAMatch(stack, 'match-1');

    const res = await request(app).get(`/api/dashboard/players/${PLAYER_ID}/profile`).query({ gameId: GAME_ID });
    expect(res.status).toBe(200);
    expect(res.body.playerId).toBe(PLAYER_ID);
    expect(res.body.semanticProfile.length).toBeGreaterThan(0);
    expect(res.body.recentMatches.length).toBe(1);
  });

  it('GET /dashboard/players/:playerId/dimensions returns updated dimensions', async () => {
    await completeAMatch(stack, 'match-2');

    const res = await request(app).get(`/api/dashboard/players/${PLAYER_ID}/dimensions`).query({ gameId: GAME_ID });
    expect(res.status).toBe(200);
    expect(res.body.dimensions.some((d: { dimension: string }) => d.dimension === 'aggression')).toBe(true);
  });

  it('GET /dashboard/players/:playerId/dimensions/:dimension/history returns version history', async () => {
    await completeAMatch(stack, 'match-3');

    const res = await request(app).get(`/api/dashboard/players/${PLAYER_ID}/dimensions/aggression/history`).query({ gameId: GAME_ID });
    expect(res.status).toBe(200);
    expect(res.body.history.length).toBeGreaterThan(0);
    expect(res.body.history[0].dimension).toBe('aggression');
  });

  it('GET /dashboard/players/:playerId/patterns returns detected patterns and requires gameId', async () => {
    await completeAMatch(stack, 'match-4');

    const missingGameId = await request(app).get(`/api/dashboard/players/${PLAYER_ID}/patterns`);
    expect(missingGameId.status).toBe(400);

    const res = await request(app).get(`/api/dashboard/players/${PLAYER_ID}/patterns`).query({ gameId: GAME_ID });
    expect(res.status).toBe(200);
    expect(res.body.patterns.some((p: { patternId: string }) => p.patternId === 'dodgeDirection:left')).toBe(true);
  });

  it('GET /dashboard/players/:playerId/episodes returns 200 with an empty list when none exist', async () => {
    const res = await request(app).get(`/api/dashboard/players/${PLAYER_ID}/episodes`);
    expect(res.status).toBe(200);
    expect(res.body.episodes).toEqual([]);
  });

  it('GET /dashboard/matches/:matchId/report returns 404 before completion and 200 after', async () => {
    const before = await request(app).get('/api/dashboard/matches/match-5/report');
    expect(before.status).toBe(404);

    await completeAMatch(stack, 'match-5');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const after = await request(app).get('/api/dashboard/matches/match-5/report');
    expect(after.status).toBe(200);
    expect(after.body.matchId).toBe('match-5');
    expect(after.body.status).toBe('complete');
  });

  it('GET /dashboard/players/:playerId/reports lists recent processing history', async () => {
    await completeAMatch(stack, 'match-6');
    await completeAMatch(stack, 'match-7');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const res = await request(app).get(`/api/dashboard/players/${PLAYER_ID}/reports`);
    expect(res.status).toBe(200);
    expect(res.body.reportCount).toBe(2);
  });
});
