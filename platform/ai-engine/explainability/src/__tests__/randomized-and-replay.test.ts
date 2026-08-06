import { describe, it, expect } from 'vitest';
import { explainDecision } from '../decision-explainer';
import { explainStrategy } from '../strategy-explainer';
import { buildRealExplanationInputs, buildPatterns, buildSemanticProfile, buildEpisodes, testConfig, PLAYER_ID, GAME_ID } from './fixtures';
import { PersonalityArchetype } from '../types';

const PERSONALITIES: PersonalityArchetype[] = ['aggressive', 'patient', 'hunter', 'defensive', 'psychological', 'experimental', 'supportive'];

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

describe('randomized scenarios', () => {
  it('never fabricates patterns/traits/memories across many randomized inputs — every surfaced item is always traceable to AwarenessUsed', () => {
    const next = seededRandom(7);
    const config = testConfig();

    for (let i = 0; i < 40; i++) {
      const awarenessBudget = next();
      const personality = PERSONALITIES[Math.floor(next() * PERSONALITIES.length)];
      const selfHealth = next();

      const inputs = buildRealExplanationInputs({
        strategicIntentOptions: { awarenessBudget, personality, publicGameState: { selfHealth, openingAvailable: next() > 0.5 } },
        decisionOptions: { awarenessBudget, publicGameState: { selfHealth, openingAvailable: next() > 0.5 } },
      });

      const explanation = explainDecision(inputs, config);

      // Truthfulness invariant: every surfaced pattern/trait id must appear in the decision's own AwarenessUsed record.
      expect(explanation.patternsUsed.map((p) => p.patternId).sort()).toEqual([...inputs.decision.reasoningTrace.awarenessUsed.patternIdsRead].sort());
      expect(explanation.playerTraitsUsed.map((t) => t.dimension).sort()).toEqual([...inputs.decision.reasoningTrace.awarenessUsed.semanticDimensionsRead].sort());

      // Structural invariants that must hold for every possible decision.
      expect(explanation.confidence.value).toBeGreaterThanOrEqual(0);
      expect(explanation.confidence.value).toBeLessThanOrEqual(1);
      expect(explanation.traceability.length).toBe(explanation.naturalLanguage.length);
      expect([explanation.primaryReason, ...explanation.supportingEvidence]).toHaveLength(inputs.decision.score.breakdown.length);

      // Beginner tier must never surface a pattern or trait — the strongest possible truthfulness check.
      if (explanation.awarenessTier === 'beginner') {
        expect(explanation.patternsUsed).toEqual([]);
        expect(explanation.playerTraitsUsed).toEqual([]);
      }
    }
  });
});

describe('replay determinism', () => {
  it('the same StrategicIntent replayed through explainStrategy always yields the same structured content', () => {
    const next = seededRandom(99);
    const config = testConfig();
    for (let i = 0; i < 10; i++) {
      const inputs = buildRealExplanationInputs({ strategicIntentOptions: { awarenessBudget: next(), personality: PERSONALITIES[Math.floor(next() * PERSONALITIES.length)] } });
      const a = explainStrategy(inputs.strategicIntent, config);
      const b = explainStrategy(inputs.strategicIntent, config);
      const { explanationId: idA, ...restA } = a;
      const { explanationId: idB, ...restB } = b;
      expect(idA).not.toBe(idB);
      expect(restA).toEqual(restB);
    }
  });

  it('an already-produced Decision replayed with unchanged context always yields the same DecisionExplanation content', () => {
    const config = testConfig();
    const patterns = buildPatterns();
    const semanticProfile = buildSemanticProfile();
    const episodes = buildEpisodes();
    const inputs = buildRealExplanationInputs({ patterns, semanticProfile, episodes });

    const results = Array.from({ length: 5 }, () => explainDecision({ decision: inputs.decision, strategicIntent: inputs.strategicIntent, semanticProfile, patterns, episodes }, config));
    const stripped = results.map(({ explanationId, ...rest }) => rest);
    for (let i = 1; i < stripped.length; i++) expect(stripped[i]).toEqual(stripped[0]);
  });
});
