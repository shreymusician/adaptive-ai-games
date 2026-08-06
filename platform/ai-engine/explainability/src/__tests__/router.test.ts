import { describe, it, expect, beforeEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { Db } from 'mongodb';
import { ExplainabilityEngine } from '../explainability-engine';
import { ExplanationStore } from '../explanation-store';
import { createExplainabilityRouter } from '../router';
import { rootLogger } from '../logger';
import { FakeDb } from './fake-mongo';
import { buildRealExplanationInputs, PLAYER_ID } from './fixtures';

describe('explainability router', () => {
  let app: Express;
  let engine: ExplainabilityEngine;

  beforeEach(() => {
    const store = new ExplanationStore(new FakeDb() as unknown as Db);
    engine = new ExplainabilityEngine({ store });
    app = express();
    app.use(createExplainabilityRouter({ engine, logger: rootLogger }));
  });

  it('GET /explainability/decisions/:decisionId returns the stored explanation', async () => {
    const explanation = await engine.explainDecision(buildRealExplanationInputs());
    const res = await request(app).get(`/explainability/decisions/${explanation.decisionId}`);
    expect(res.status).toBe(200);
    expect(res.body.decisionId).toBe(explanation.decisionId);
  });

  it('GET /explainability/decisions/:decisionId 404s for an unknown id', async () => {
    const res = await request(app).get('/explainability/decisions/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('GET /explainability/matches/:matchId/summary computes and returns the MatchSummary', async () => {
    await engine.explainDecision(buildRealExplanationInputs());
    const res = await request(app).get('/explainability/matches/match-1/summary');
    expect(res.status).toBe(200);
    expect(res.body.decisionCount).toBe(1);
  });

  it('GET /explainability/matches/:matchId/summary 404s when nothing was recorded', async () => {
    const res = await request(app).get('/explainability/matches/never-happened/summary');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('EXPLANATION_NOT_FOUND');
  });

  it('GET /explainability/players/:playerId/timeline returns stored entries', async () => {
    await engine.explainDecision(buildRealExplanationInputs());
    const res = await request(app).get(`/explainability/players/${PLAYER_ID}/timeline`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  it('GET /explainability/players/:playerId/history supports pagination', async () => {
    await engine.explainDecision(buildRealExplanationInputs({ decisionOptions: { now: 1000 } }));
    await engine.explainDecision(buildRealExplanationInputs({ decisionOptions: { now: 2000 } }));
    const res = await request(app).get(`/explainability/players/${PLAYER_ID}/history?limit=1`);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.total).toBe(2);
  });
});
