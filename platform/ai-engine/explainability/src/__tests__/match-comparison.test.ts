import { describe, it, expect } from 'vitest';
import { explainDecision } from '../decision-explainer';
import { summarizeMatch } from '../match-summary';
import { compareMatches } from '../match-comparison';
import { buildRealExplanationInputs, testConfig, PLAYER_ID, GAME_ID } from './fixtures';
import { DecisionExplanation, SemanticProfileEntry } from '../types';
import { StrategicIntent } from '@adaptive-ai/strategy-planner';
import { Decision } from '@adaptive-ai/decision-engine';

function explanationForMatch(matchId: string, now: number, strategicIntentOverrides: Partial<Parameters<typeof buildRealExplanationInputs>[0]>['strategicIntentOptions'] = {}): DecisionExplanation {
  const matchContext = { matchId, playerId: PLAYER_ID, gameId: GAME_ID, elapsedMs: 30000 };
  const inputs = buildRealExplanationInputs({
    strategicIntentOptions: { matchContext, ...strategicIntentOverrides },
    decisionOptions: { matchContext, now },
  });
  return explainDecision(inputs, testConfig());
}

describe('compareMatches', () => {
  it('reports a dimension delta only for dimensions present in BOTH snapshots', () => {
    const config = testConfig();
    const before = summarizeMatch([explanationForMatch('match-a', 1000)], 'match-a', 5000, config);
    const after = summarizeMatch([explanationForMatch('match-b', 1000)], 'match-b', 6000, config);

    const dimsBefore: SemanticProfileEntry[] = [
      { dimension: 'aggression', gameId: 'game-1', value: 0.3, confidence: 0.7, samples: 20 },
      { dimension: 'onlyBefore', gameId: 'game-1', value: 0.5, confidence: 0.7, samples: 20 },
    ];
    const dimsAfter: SemanticProfileEntry[] = [
      { dimension: 'aggression', gameId: 'game-1', value: 0.7, confidence: 0.7, samples: 20 },
      { dimension: 'onlyAfter', gameId: 'game-1', value: 0.5, confidence: 0.7, samples: 20 },
    ];

    const comparison = compareMatches(before, after, dimsBefore, dimsAfter, 7000, config);
    expect(comparison.dimensionDeltas).toHaveLength(1);
    expect(comparison.dimensionDeltas[0].dimension).toBe('aggression');
    expect(comparison.dimensionDeltas[0].delta).toBeCloseTo(0.4, 10);
    expect(comparison.dimensionDeltas[0].direction).toBe('increasing');
  });

  it('decisionCountDelta and averageUtilityDelta come directly from the two MatchSummaries', () => {
    const config = testConfig();
    const explA = explanationForMatch('match-a', 1000);
    const explB1 = explanationForMatch('match-b', 2000);
    const explB2 = explanationForMatch('match-b', 3000);
    const before = summarizeMatch([explA], 'match-a', 5000, config);
    const after = summarizeMatch([explB1, explB2], 'match-b', 6000, config);

    const comparison = compareMatches(before, after, [], [], 7000, config);
    expect(comparison.decisionCountDelta).toBe(after.decisionCount - before.decisionCount);
    expect(comparison.averageUtilityDelta).toBeCloseTo(after.averageUtility - before.averageUtility, 10);
  });

  it('personalityChanged is only true when BOTH matches have a single, differing, known personality', () => {
    const config = testConfig();
    const beforeExpl = explanationForMatch('match-a', 1000, { personality: 'aggressive' });
    const afterExpl = explanationForMatch('match-b', 1000, { personality: 'defensive' });
    const before = summarizeMatch([beforeExpl], 'match-a', 5000, config);
    const after = summarizeMatch([afterExpl], 'match-b', 6000, config);
    const comparison = compareMatches(before, after, [], [], 7000, config);
    expect(comparison.personalityChanged).toBe(true);
  });
});
