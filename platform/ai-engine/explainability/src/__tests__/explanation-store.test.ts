import { describe, it, expect } from 'vitest';
import { Db } from 'mongodb';
import { ExplanationStore } from '../explanation-store';
import { explainDecision } from '../decision-explainer';
import { explainPattern } from '../pattern-explainer';
import { FakeDb } from './fake-mongo';
import { buildPatterns, buildRealExplanationInputs, testConfig, MATCH_ID, PLAYER_ID, GAME_ID } from './fixtures';

function newStore(): ExplanationStore {
  return new ExplanationStore(new FakeDb() as unknown as Db);
}

describe('ExplanationStore', () => {
  it('store() then getById() round-trips the explanation unchanged', async () => {
    const store = newStore();
    const explanation = explainDecision(buildRealExplanationInputs(), testConfig());
    await store.store('decision', explanation, 5000);
    const doc = await store.getById(explanation.explanationId);
    expect(doc?.explanation).toEqual(explanation);
    expect(doc?.matchId).toBe(explanation.matchId);
    expect(doc?.decisionId).toBe(explanation.decisionId);
  });

  it('getByDecisionId finds a stored decision explanation by its decisionId', async () => {
    const store = newStore();
    const explanation = explainDecision(buildRealExplanationInputs(), testConfig());
    await store.store('decision', explanation);
    const doc = await store.getByDecisionId(explanation.decisionId);
    expect(doc?.explanationId).toBe(explanation.explanationId);
  });

  it('getForMatch returns every stored decision explanation for one match, chronological', async () => {
    const store = newStore();
    const e1 = explainDecision(buildRealExplanationInputs({ decisionOptions: { now: 1000 } }), testConfig());
    const e2 = explainDecision(buildRealExplanationInputs({ decisionOptions: { now: 2000 } }), testConfig());
    await store.store('decision', e2);
    await store.store('decision', e1);
    const docs = await store.getForMatch(MATCH_ID, 'decision');
    expect(docs.map((d) => d.generatedAt)).toEqual([1000, 2000]);
  });

  it('store() upserts a deterministic-id explanation (e.g. a re-computed MatchSummary) rather than duplicating it', async () => {
    const store = newStore();
    const [pattern] = buildPatterns();
    const first = explainPattern(pattern, PLAYER_ID, GAME_ID, 1000, testConfig());
    const second = explainPattern({ ...pattern, confidence: 0.99 }, PLAYER_ID, GAME_ID, 2000, testConfig());
    const forcedId = { ...second, explanationId: first.explanationId };
    await store.store('pattern', first);
    await store.store('pattern', forcedId);
    const doc = await store.getById(first.explanationId);
    expect(doc?.explanation).toEqual(forcedId);
  });

  it('getLatestByPatternId returns the most recently stored pattern explanation', async () => {
    const store = newStore();
    const [pattern] = buildPatterns();
    const e1 = explainPattern(pattern, PLAYER_ID, GAME_ID, 1000, testConfig());
    const e2 = explainPattern(pattern, PLAYER_ID, GAME_ID, 2000, testConfig());
    await store.store('pattern', e1);
    await store.store('pattern', e2);
    const latest = await store.getLatestByPatternId(PLAYER_ID, pattern.patternId);
    expect(latest?.generatedAt).toBe(2000);
  });

  it('search paginates and filters by explanationType', async () => {
    const store = newStore();
    const [pattern] = buildPatterns();
    await store.store('decision', explainDecision(buildRealExplanationInputs(), testConfig()));
    await store.store('pattern', explainPattern(pattern, PLAYER_ID, GAME_ID, 1000, testConfig()));
    const { explanations, total } = await store.search({ playerId: PLAYER_ID, explanationType: 'pattern' });
    expect(total).toBe(1);
    expect(explanations[0].explanationType).toBe('pattern');
  });

  it('getTimeline returns entries across explanation types, most recent first', async () => {
    const store = newStore();
    const [pattern] = buildPatterns();
    await store.store('decision', explainDecision(buildRealExplanationInputs({ decisionOptions: { now: 1000 } }), testConfig()));
    await store.store('pattern', explainPattern(pattern, PLAYER_ID, GAME_ID, 2000, testConfig()));
    const docs = await store.getTimeline(PLAYER_ID);
    expect(docs.map((d) => d.generatedAt)).toEqual([2000, 1000]);
  });
});
