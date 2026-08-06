import { describe, it, expect } from 'vitest';
import { explainDecision } from '../decision-explainer';
import { buildRealDecision, buildRealStrategicIntent, buildPatterns, buildSemanticProfile, buildEpisodes, testConfig } from './fixtures';
import { ExplanationInputs } from '../types';

function explanationAt(awarenessBudget: number) {
  const strategicIntent = buildRealStrategicIntent({ awarenessBudget });
  const decision = buildRealDecision(strategicIntent, { awarenessBudget });
  const inputs: ExplanationInputs = { decision, strategicIntent, semanticProfile: buildSemanticProfile(), patterns: buildPatterns(), episodes: buildEpisodes() };
  return { explanation: explainDecision(inputs, testConfig()), decision, strategicIntent };
}

describe('Awareness Budget enforcement — tier-by-tier truthfulness', () => {
  it('beginner tier (budget < 0.34): never surfaces any pattern or trait, regardless of what is available', () => {
    const { explanation, decision } = explanationAt(0.1);
    expect(decision.metadata.awarenessTier).toBe('beginner');
    expect(explanation.awarenessTier).toBe('beginner');
    expect(explanation.patternsUsed).toEqual([]);
    expect(explanation.playerTraitsUsed).toEqual([]);
  });

  it('veteran tier (0.34 <= budget < 0.67): semantic profile traits may surface, patterns never do', () => {
    const { explanation, decision } = explanationAt(0.5);
    expect(decision.metadata.awarenessTier).toBe('veteran');
    expect(explanation.awarenessTier).toBe('veteran');
    expect(explanation.patternsUsed).toEqual([]);
    // Traits are only surfaced if a consideration actually opted to read one this decision — never guaranteed non-empty, but never patterns either way.
    expect(decision.reasoningTrace.awarenessUsed.patternIdsRead).toEqual([]);
  });

  it('expert tier (budget >= 0.67): both patterns and traits may surface, but ONLY confirmed/strong patterns', () => {
    const { explanation, decision } = explanationAt(0.95);
    expect(decision.metadata.awarenessTier).toBe('expert');
    expect(explanation.awarenessTier).toBe('expert');
    // Every pattern actually surfaced must be confirmed or strong — never a raw candidate.
    for (const p of explanation.patternsUsed) expect(['confirmed', 'strong']).toContain(p.state);
  });

  it('a weak/candidate-state pattern is never surfaced even at expert tier', () => {
    const patterns = [{ patternId: 'candidate-pattern', detectorId: 'd', patternKey: 'k', category: 'combat', state: 'candidate' as const, confidence: 0.9, description: 'Not yet trusted' }];
    const strategicIntent = buildRealStrategicIntent({ awarenessBudget: 0.95, patterns });
    const decision = buildRealDecision(strategicIntent, { awarenessBudget: 0.95, patterns });
    expect(decision.reasoningTrace.awarenessUsed.patternIdsRead).toEqual([]);
  });

  it('beginner tier never surfaces evidence that IS visible at expert tier for the identical scenario', () => {
    const low = explanationAt(0.1);
    const high = explanationAt(0.95);
    expect(low.explanation.patternsUsed).toEqual([]);
    expect(low.explanation.playerTraitsUsed).toEqual([]);
    // Expert tier, with the same underlying data, genuinely sees more (or equal) — proving the beginner-tier emptiness above is gating, not coincidence.
    expect(high.explanation.patternsUsed.length + high.explanation.playerTraitsUsed.length).toBeGreaterThan(0);
  });
});
