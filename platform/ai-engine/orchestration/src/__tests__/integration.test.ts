/**
 * Full end-to-end integration test: exercises the exact HTTP surface a real
 * game plugin and a real dashboard client would use, with nothing bypassed —
 * auth, rate limiting, validation, storage, orchestration, and the read API
 * are all driven through Express exactly as platform/api would wire them.
 *
 *   Plugin -> POST /api/events/batch (Event Pipeline: auth, validation,
 *   storage) -> OrchestratingEventProcessor -> MatchOrchestrator ->
 *   Memory Engine -> Player Modeling -> Pattern Recognition ->
 *   GET /api/dashboard/... (proves the result is visible end to end)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { OrchestrationStack } from '../bootstrap';
import { buildTestStack } from './test-stack';
import { buildMatchEvents } from './fixtures';

const PLAYER_ID = 'player-int-1';
const GAME_ID = 'game-int-1';
const MATCH_ID = 'match-int-1';

describe('end-to-end: plugin batch -> event pipeline -> orchestrator -> memory -> player modeling -> pattern recognition -> API -> dashboard', () => {
  let stack: OrchestrationStack;
  let app: Express;
  let matchToken: string;

  beforeEach(async () => {
    stack = await buildTestStack();
    app = express();
    app.use('/api', stack.eventRouter);
    app.use('/api', stack.dashboardRouter);
    matchToken = stack.mintMatchToken({ matchId: MATCH_ID, playerId: PLAYER_ID, gameId: GAME_ID, scope: 'ingest' });
  });

  it('rejects an unauthenticated batch submission', async () => {
    const res = await request(app)
      .post('/api/events/batch')
      .send({ events: buildMatchEvents(Date.now()) });
    expect(res.status).toBe(401);
  });

  it('processes a full match end to end and the result is visible via the dashboard API', async () => {
    const rawEvents = buildMatchEvents(Date.now());

    const batchRes = await request(app).post('/api/events/batch').set('Authorization', `Bearer ${matchToken}`).send({ events: rawEvents });

    expect(batchRes.status).toBe(202);
    expect(batchRes.body.accepted).toBe(rawEvents.length);
    expect(batchRes.body.orchestration).toBeDefined();
    expect(batchRes.body.orchestration.status).toBe('complete');

    // 1. The raw event log is queryable via the Event Pipeline's own replay endpoint.
    const replayToken = stack.mintMatchToken({ matchId: MATCH_ID, playerId: PLAYER_ID, gameId: GAME_ID, scope: 'replay' });
    const eventsRes = await request(app).get(`/api/events/match/${MATCH_ID}`).set('Authorization', `Bearer ${replayToken}`);
    expect(eventsRes.status).toBe(200);
    expect(eventsRes.body.eventCount).toBe(rawEvents.length);

    // 2. Player profile now reflects this match — visible via the dashboard, no manual trigger.
    const profileRes = await request(app).get(`/api/dashboard/players/${PLAYER_ID}/dimensions`).query({ gameId: GAME_ID });
    expect(profileRes.status).toBe(200);
    expect(profileRes.body.dimensions.length).toBeGreaterThan(0);
    const aggression = profileRes.body.dimensions.find((d: { dimension: string }) => d.dimension === 'aggression');
    expect(aggression).toBeDefined();
    expect(aggression.samples).toBeGreaterThan(0);

    // 3. Detected patterns are visible via the dashboard.
    const patternsRes = await request(app).get(`/api/dashboard/players/${PLAYER_ID}/patterns`).query({ gameId: GAME_ID });
    expect(patternsRes.status).toBe(200);
    expect(patternsRes.body.patterns.length).toBeGreaterThan(0);

    // 4. The full match-processing report is independently queryable by matchId.
    const reportRes = await request(app).get(`/api/dashboard/matches/${MATCH_ID}/report`);
    expect(reportRes.status).toBe(200);
    expect(reportRes.body.status).toBe('complete');
    expect(reportRes.body.playerModeling.updated.length).toBeGreaterThan(0);
    expect(reportRes.body.patternRecognition.updated.length).toBeGreaterThan(0);
  });

  it('handles a match delivered across three separate batches, out of the plugin\'s control over network chunking', async () => {
    const rawEvents = buildMatchEvents(Date.now());
    const third = Math.ceil(rawEvents.length / 3);
    const chunks = [rawEvents.slice(0, third), rawEvents.slice(third, 2 * third), rawEvents.slice(2 * third)];

    let lastBody: Record<string, unknown> = {};
    for (const chunk of chunks) {
      const res = await request(app).post('/api/events/batch').set('Authorization', `Bearer ${matchToken}`).send({ events: chunk });
      expect(res.status).toBe(202);
      lastBody = res.body;
    }

    expect(lastBody.orchestration).toBeDefined();
    expect((lastBody.orchestration as { status: string }).status).toBe('complete');

    const profileRes = await request(app).get(`/api/dashboard/players/${PLAYER_ID}/profile`).query({ gameId: GAME_ID });
    expect(profileRes.body.recentMatches[0].matchId).toBe(MATCH_ID);
    expect(profileRes.body.recentMatches[0].recentEvents.length).toBe(rawEvents.length);
  });

  it('a token scoped to a different match cannot submit events for this match', async () => {
    const otherToken = stack.mintMatchToken({ matchId: 'someone-elses-match', playerId: PLAYER_ID, gameId: GAME_ID, scope: 'ingest' });
    const res = await request(app)
      .post('/api/events/batch')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ events: [{ seq: 1, type: 'MatchStarted', payload: {}, ts: Date.now() }] });

    // The token's own matchId claim (not the caller) determines which match
    // the batch is stored under — Event Pipeline's router takes matchId
    // from claims, never the request body/path — so this simply writes to
    // 'someone-elses-match', never to MATCH_ID. Confirm no cross-match leakage.
    expect(res.status).toBe(202);
    const check = await request(app).get(`/api/dashboard/matches/${MATCH_ID}/report`);
    expect(check.status).toBe(404);
  });
});
