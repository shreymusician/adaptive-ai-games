import { describe, it, expect } from 'vitest';
import { explainDecision } from '../decision-explainer';
import { IntentDecisionMismatchError, MalformedDecisionTraceError, MissingReasoningDataError } from '../errors';
import { buildEpisodes, buildPatterns, buildRealDecision, buildRealExplanationInputs, buildRealStrategicIntent, buildSemanticProfile, testConfig } from './fixtures';
import { Decision, ExplanationInputs } from '../types';

describe('explainDecision — traceability', () => {
  it('every naturalLanguage sentence has a corresponding traceability entry, same index', () => {
    const inputs = buildRealExplanationInputs();
    const explanation = explainDecision(inputs, testConfig());
    expect(explanation.traceability.length).toBe(explanation.naturalLanguage.length);
  });

  it('primaryReason is the highest weight*value contribution among the winning breakdown, ties broken by considerationId', () => {
    const inputs = buildRealExplanationInputs();
    const explanation = explainDecision(inputs, testConfig());
    const allContributions = [explanation.primaryReason, ...explanation.supportingEvidence].map((c) => c.contribution);
    expect(explanation.primaryReason.contribution).toBe(Math.max(...allContributions));
  });

  it('alternativesConsidered excludes the winner itself (rank 1) and reports the correct utility gap', () => {
    const inputs = buildRealExplanationInputs();
    const decision = inputs.decision;
    const explanation = explainDecision(inputs, testConfig());
    expect(explanation.alternativesConsidered.every((a) => a.rank > 1)).toBe(true);
    for (const alt of explanation.alternativesConsidered) {
      expect(alt.utilityGapFromWinner).toBeCloseTo(decision.score.utility - alt.utility, 10);
    }
  });

  it('primaryReason/supportingEvidence together cover every consideration in decision.score.breakdown exactly once', () => {
    const inputs = buildRealExplanationInputs();
    const explanation = explainDecision(inputs, testConfig());
    const explained = [explanation.primaryReason.considerationId, ...explanation.supportingEvidence.map((s) => s.considerationId)].sort();
    const original = inputs.decision.score.breakdown.map((b) => b.considerationId).sort();
    expect(explained).toEqual(original);
  });
});

describe('explainDecision — truthfulness (awareness-budget enforcement)', () => {
  it('patternsUsed contains ONLY patterns recorded in decision.reasoningTrace.awarenessUsed.patternIdsRead', () => {
    const inputs = buildRealExplanationInputs();
    const explanation = explainDecision(inputs, testConfig());
    expect(explanation.patternsUsed.map((p) => p.patternId).sort()).toEqual([...inputs.decision.reasoningTrace.awarenessUsed.patternIdsRead].sort());
  });

  it('playerTraitsUsed contains ONLY dimensions recorded in decision.reasoningTrace.awarenessUsed.semanticDimensionsRead', () => {
    const inputs = buildRealExplanationInputs();
    const explanation = explainDecision(inputs, testConfig());
    expect(explanation.playerTraitsUsed.map((t) => t.dimension).sort()).toEqual([...inputs.decision.reasoningTrace.awarenessUsed.semanticDimensionsRead].sort());
  });

  it('memoriesReferenced contains ONLY episodes recorded in strategicIntent.awarenessUsed.episodeIdsRead', () => {
    const inputs = buildRealExplanationInputs();
    const explanation = explainDecision(inputs, testConfig());
    expect(explanation.memoriesReferenced.map((m) => m.episodeId).sort()).toEqual([...inputs.strategicIntent.awarenessUsed.episodeIdsRead].sort());
  });

  it('at beginner awareness tier, decision-level patterns/traits are structurally never read (empty), so nothing can leak into the explanation', () => {
    const strategicIntent = buildRealStrategicIntent({ awarenessBudget: 0.05 });
    const decision = buildRealDecision(strategicIntent, { awarenessBudget: 0.05 });
    const inputs: ExplanationInputs = { decision, strategicIntent, semanticProfile: buildSemanticProfile(), patterns: buildPatterns(), episodes: buildEpisodes() };
    const explanation = explainDecision(inputs, testConfig());
    expect(explanation.patternsUsed).toEqual([]);
    expect(explanation.playerTraitsUsed).toEqual([]);
    expect(explanation.awarenessTier).toBe('beginner');
  });

  it('a caller-supplied pattern/dimension the decision never read is never surfaced, even if it exists in the full context', () => {
    const inputs = buildRealExplanationInputs({ patterns: [...buildPatterns(), { patternId: 'unrelated-pattern', detectorId: 'd', patternKey: 'k', category: 'exploration', state: 'confirmed', confidence: 0.9, description: 'Never actually read' }] });
    const explanation = explainDecision(inputs, testConfig());
    expect(explanation.patternsUsed.some((p) => p.patternId === 'unrelated-pattern')).toBe(false);
  });
});

describe('explainDecision — missing reasoning data', () => {
  it('throws MissingReasoningDataError when a pattern recorded as read is absent from the supplied context', () => {
    // The decision genuinely read a pattern at decide() time (real patterns were fed to the engine) — only the EXPLAINER's caller-supplied context is stripped afterward, simulating a stale/incomplete snapshot handed to explainDecision.
    const inputs = buildRealExplanationInputs();
    expect(inputs.decision.reasoningTrace.awarenessUsed.patternIdsRead.length).toBeGreaterThan(0);
    expect(() => explainDecision({ ...inputs, patterns: [] }, testConfig())).toThrow(MissingReasoningDataError);
  });

  it('throws MissingReasoningDataError when a semantic dimension recorded as read is absent from the supplied context', () => {
    const inputs = buildRealExplanationInputs();
    expect(inputs.decision.reasoningTrace.awarenessUsed.semanticDimensionsRead.length).toBeGreaterThan(0);
    expect(() => explainDecision({ ...inputs, semanticProfile: [] }, testConfig())).toThrow(MissingReasoningDataError);
  });

  it('throws MissingReasoningDataError when a referenced episode is absent from the supplied context', () => {
    // Force episodeIdsRead to be non-empty via a hand-built StrategicIntent, since no shipped Goal currently reads episodic memory.
    const strategicIntent = buildRealStrategicIntent();
    const withEpisodeRead = { ...strategicIntent, awarenessUsed: { ...strategicIntent.awarenessUsed, episodeIdsRead: ['episode-not-supplied'] } };
    const decision = buildRealDecision(strategicIntent);
    const explanationInputs: ExplanationInputs = { decision, strategicIntent: withEpisodeRead, semanticProfile: buildSemanticProfile(), patterns: buildPatterns(), episodes: [] };
    expect(() => explainDecision(explanationInputs, testConfig())).toThrow(MissingReasoningDataError);
  });
});

describe('explainDecision — malformed input', () => {
  it('throws IntentDecisionMismatchError when the StrategicIntent goalId does not match the Decision reasoningTrace', () => {
    const strategicIntentA = buildRealStrategicIntent();
    const decisionA = buildRealDecision(strategicIntentA);
    const strategicIntentB = buildRealStrategicIntent({ awarenessBudget: 0.1, personality: 'defensive', publicGameState: { selfHealth: 0.05 } });
    const inputs: ExplanationInputs = { decision: decisionA, strategicIntent: strategicIntentB, semanticProfile: buildSemanticProfile(), patterns: buildPatterns(), episodes: buildEpisodes() };
    expect(() => explainDecision(inputs, testConfig())).toThrow(IntentDecisionMismatchError);
  });

  it('throws MalformedDecisionTraceError when the winning breakdown is empty', () => {
    const inputs = buildRealExplanationInputs();
    const malformed: Decision = { ...inputs.decision, score: { ...inputs.decision.score, breakdown: [] } };
    expect(() => explainDecision({ ...inputs, decision: malformed }, testConfig())).toThrow(MalformedDecisionTraceError);
  });
});

describe('explainDecision — confidence', () => {
  it('confidence.value is exactly decision.score.confidence, never re-derived', () => {
    const inputs = buildRealExplanationInputs();
    const explanation = explainDecision(inputs, testConfig());
    expect(explanation.confidence.value).toBe(inputs.decision.score.confidence);
  });
});

describe('explainDecision — determinism', () => {
  it('the same inputs produce byte-identical output apart from explanationId', () => {
    const inputs = buildRealExplanationInputs();
    const config = testConfig();
    const a = explainDecision(inputs, config);
    const b = explainDecision(inputs, config);
    const { explanationId: idA, ...restA } = a;
    const { explanationId: idB, ...restB } = b;
    expect(idA).not.toBe(idB);
    expect(restA).toEqual(restB);
  });

  it('generatedAt is always decision.executionTimestamp, never wall-clock time', () => {
    const inputs = buildRealExplanationInputs({ decisionOptions: { now: 424242 } });
    const explanation = explainDecision(inputs, testConfig());
    expect(explanation.generatedAt).toBe(424242);
    expect(explanation.generatedAt).toBe(inputs.decision.executionTimestamp);
  });
});
