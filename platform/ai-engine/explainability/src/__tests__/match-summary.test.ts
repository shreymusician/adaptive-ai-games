import { describe, it, expect } from 'vitest';
import { explainDecision } from '../decision-explainer';
import { summarizeMatch } from '../match-summary';
import { EmptyDecisionSetError, InconsistentMatchDataError } from '../errors';
import { buildRealExplanationInputs, testConfig, MATCH_ID } from './fixtures';

function threeDecisions() {
  const config = testConfig();
  return [
    explainDecision(buildRealExplanationInputs({ strategicIntentOptions: { personality: 'aggressive' }, decisionOptions: { now: 1000 } }), config),
    explainDecision(buildRealExplanationInputs({ strategicIntentOptions: { personality: 'patient' }, decisionOptions: { now: 2000 } }), config),
    explainDecision(buildRealExplanationInputs({ strategicIntentOptions: { personality: 'defensive' }, decisionOptions: { now: 3000 } }), config),
  ];
}

describe('summarizeMatch', () => {
  it('decisionCount matches the input array length', () => {
    const summary = summarizeMatch(threeDecisions(), MATCH_ID, 5000, testConfig());
    expect(summary.decisionCount).toBe(3);
  });

  it('averageUtility is the real mean of every decision summary.utility', () => {
    const decisions = threeDecisions();
    const summary = summarizeMatch(decisions, MATCH_ID, 5000, testConfig());
    const expected = decisions.reduce((a, d) => a + d.summary.utility, 0) / decisions.length;
    expect(summary.averageUtility).toBeCloseTo(expected, 10);
  });

  it('closestCalls/mostDecisive are ranked by confidence, complementary at the extremes', () => {
    const decisions = threeDecisions();
    const summary = summarizeMatch(decisions, MATCH_ID, 5000, testConfig({ maxKeyMoments: 1 }));
    expect(summary.closestCalls).toHaveLength(1);
    expect(summary.mostDecisive).toHaveLength(1);
    const byConfidence = [...decisions].sort((a, b) => a.confidence.value - b.confidence.value);
    expect(summary.closestCalls[0].decisionId).toBe(byConfidence[0].decisionId);
    expect(summary.mostDecisive[0].decisionId).toBe(byConfidence[byConfidence.length - 1].decisionId);
  });

  it('throws EmptyDecisionSetError for an empty array', () => {
    expect(() => summarizeMatch([], MATCH_ID, 5000, testConfig())).toThrow(EmptyDecisionSetError);
  });

  it('throws InconsistentMatchDataError when a decision belongs to a different match', () => {
    const decisions = threeDecisions();
    expect(() => summarizeMatch(decisions, 'some-other-match', 5000, testConfig())).toThrow(InconsistentMatchDataError);
  });

  it('is deterministic apart from generatedAt/explanationId being caller-supplied', () => {
    const decisions = threeDecisions();
    const config = testConfig();
    const a = summarizeMatch(decisions, MATCH_ID, 5000, config);
    const b = summarizeMatch(decisions, MATCH_ID, 5000, config);
    expect(a).toEqual(b);
  });
});
