import { describe, it, expect } from 'vitest';
import { Db } from 'mongodb';
import { ExplainabilityEngine } from '../explainability-engine';
import { ExplanationStore } from '../explanation-store';
import { ExplanationNotFoundError } from '../errors';
import { FakeDb } from './fake-mongo';
import { buildRealExplanationInputs, PLAYER_ID, GAME_ID } from './fixtures';

function newEngine(): ExplainabilityEngine {
  const store = new ExplanationStore(new FakeDb() as unknown as Db);
  return new ExplainabilityEngine({ store });
}

describe('ExplainabilityEngine', () => {
  it('explainDecision generates and persists; getByDecisionId retrieves it back', async () => {
    const engine = newEngine();
    const explanation = await engine.explainDecision(buildRealExplanationInputs());
    const doc = await engine.getByDecisionId(explanation.decisionId);
    expect(doc?.explanation).toEqual(explanation);
  });

  it('summarizeMatch aggregates every stored decision explanation for a match', async () => {
    const engine = newEngine();
    await engine.explainDecision(buildRealExplanationInputs({ decisionOptions: { now: 1000 } }));
    await engine.explainDecision(buildRealExplanationInputs({ decisionOptions: { now: 2000 } }));
    const summary = await engine.summarizeMatch('match-1');
    expect(summary.decisionCount).toBe(2);
  });

  it('summarizeMatch throws ExplanationNotFoundError when no decisions are stored for the match', async () => {
    const engine = newEngine();
    await expect(engine.summarizeMatch('never-happened')).rejects.toThrow(ExplanationNotFoundError);
  });

  it('compareMatches throws ExplanationNotFoundError when a MatchSummary was never computed', async () => {
    const engine = newEngine();
    await expect(engine.compareMatches('match-a', 'match-b', [], [])).rejects.toThrow(ExplanationNotFoundError);
  });

  it('generatePlayerInsights persists; getLatestPlayerInsights retrieves it', async () => {
    const engine = newEngine();
    const insights = await engine.generatePlayerInsights({ playerId: PLAYER_ID, gameId: GAME_ID, profile: [], patterns: [] });
    const latest = await engine.getLatestPlayerInsights(PLAYER_ID, GAME_ID);
    expect(latest).toEqual(insights);
  });

  it('getLatestPlayerInsights returns null when nothing has been generated yet', async () => {
    const engine = newEngine();
    expect(await engine.getLatestPlayerInsights('never-seen-player')).toBeNull();
  });
});
