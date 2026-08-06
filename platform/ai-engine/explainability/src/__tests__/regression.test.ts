/**
 * Golden-output regression tests — fixed, hand-verified inputs asserted
 * against exact expected structured fields and natural-language sentences.
 * If a future change to templates.ts / decision-explainer.ts / the ranking
 * logic alters this output, one of these assertions should fail, forcing a
 * deliberate decision about whether the change is intended.
 */
import { describe, it, expect } from 'vitest';
import { explainDecision } from '../decision-explainer';
import { buildRealExplanationInputs, testConfig } from './fixtures';

describe('regression — default fixture DecisionExplanation', () => {
  it('produces the exact expected structured summary/primaryReason', () => {
    const inputs = buildRealExplanationInputs();
    const explanation = explainDecision(inputs, testConfig());

    expect(explanation.summary).toEqual({
      actionId: 'attack',
      goalId: 'forceReload',
      goalDisplayName: 'Force Reload',
      goalCategory: 'tempo',
      personality: 'aggressive',
      utility: inputs.decision.score.utility,
    });

    expect(explanation.primaryReason.considerationId).toBe('punishOpening');
    expect(explanation.awarenessTier).toBe('expert');
    expect(explanation.patternsUsed.map((p) => p.patternId)).toEqual(['pattern-rushes-low-health']);
    expect(explanation.playerTraitsUsed.map((t) => t.dimension)).toEqual(['aggression']);
    expect(explanation.memoriesReferenced).toEqual([]);
  });

  it('produces the exact expected natural-language sentence sequence', () => {
    const inputs = buildRealExplanationInputs();
    const explanation = explainDecision(inputs, testConfig());

    expect(explanation.naturalLanguage).toEqual([
      `Chose action "attack" in pursuit of "Force Reload" (tempo); utility ${explanation.summary.utility.toFixed(2)}.`,
      `The strongest factor was "punishOpening" (weight ${explanation.primaryReason.considerationWeight.toFixed(2)} × value ${explanation.primaryReason.considerationValue.toFixed(2)} = ${explanation.primaryReason.contribution.toFixed(2)}).`,
      'Supporting factors: profileExploit (0.90), patternExploit (0.83), actionFreshness (0.50), planAdherence (0.30), safety (0.50).',
      `2 alternative action(s) were considered; the closest was "wait", ${explanation.alternativesConsidered[0].utilityGapFromWinner.toFixed(2)} utility lower.`,
      'Drew on 1 known pattern(s): "Rushes enemies at low health" (high confidence (0.82)).',
      'Drew on player traits: aggression=0.85 (high confidence (0.80)).',
      'No specific past encounters were recalled for this decision.',
      `Overall decision confidence: ${explanation.confidence.level} confidence (${explanation.confidence.value.toFixed(2)}).`,
      'Awareness tier at decision time: expert.',
    ]);
  });

  it('claim order in traceability always matches: summary, primaryReason, supportingEvidence, alternativesConsidered, patternsUsed, playerTraitsUsed, memoriesReferenced, confidence, awarenessTier', () => {
    const inputs = buildRealExplanationInputs();
    const explanation = explainDecision(inputs, testConfig());
    expect(explanation.traceability.map((t) => t.claim)).toEqual([
      'summary',
      'primaryReason',
      'supportingEvidence',
      'alternativesConsidered',
      'patternsUsed',
      'playerTraitsUsed',
      'memoriesReferenced',
      'confidence',
      'awarenessTier',
    ]);
  });
});
