import { describe, it, expect } from 'vitest';
import { computeAwarenessTier, createAwarenessAccumulator, freezeAwarenessUsed, maskDecisionInputs, readPatterns, readSemanticDimension } from '../awareness-budget';
import { loadDecisionEngineConfig } from '../config';
import { baseDecisionInputs } from './fixtures';

const config = loadDecisionEngineConfig().awarenessBudget;

describe('computeAwarenessTier', () => {
  it('maps low/mid/high budgets to beginner/veteran/expert', () => {
    expect(computeAwarenessTier(0.1, config)).toBe('beginner');
    expect(computeAwarenessTier(0.5, config)).toBe('veteran');
    expect(computeAwarenessTier(0.95, config)).toBe('expert');
  });
});

describe('maskDecisionInputs — "behave as though it never learned it"', () => {
  const profile = [{ dimension: 'aggression', gameId: 'g1', value: 0.8, confidence: 0.7, samples: 20 }];
  const patterns = [{ patternId: 'p:1', detectorId: 'd', patternKey: 'k', category: 'movement', state: 'confirmed' as const, confidence: 0.7, description: 'x' }];

  it('Beginner: semantic profile and patterns both withheld', () => {
    const inputs = baseDecisionInputs({ awarenessBudget: 0.1, semanticProfile: profile, patterns });
    const { masked, tier } = maskDecisionInputs(inputs, config);
    expect(tier).toBe('beginner');
    expect(masked.semanticProfile).toEqual([]);
    expect(masked.patterns).toEqual([]);
  });

  it('Veteran: semantic profile visible, patterns still withheld', () => {
    const inputs = baseDecisionInputs({ awarenessBudget: 0.5, semanticProfile: profile, patterns });
    const { masked, tier } = maskDecisionInputs(inputs, config);
    expect(tier).toBe('veteran');
    expect(masked.semanticProfile).toEqual(profile);
    expect(masked.patterns).toEqual([]);
  });

  it('Expert: both visible, patterns filtered to confirmed/strong', () => {
    const weak = { patternId: 'p:2', detectorId: 'd', patternKey: 'k2', category: 'movement', state: 'candidate' as const, confidence: 0.2, description: 'y' };
    const inputs = baseDecisionInputs({ awarenessBudget: 0.95, semanticProfile: profile, patterns: [...patterns, weak] });
    const { masked, tier } = maskDecisionInputs(inputs, config);
    expect(tier).toBe('expert');
    expect(masked.semanticProfile).toEqual(profile);
    expect(masked.patterns).toEqual(patterns);
  });

  it('matchContext and publicGameState are never gated at any tier', () => {
    const inputs = baseDecisionInputs({ awarenessBudget: 0.05, publicGameState: { selfHealth: 0.7 } });
    const { masked } = maskDecisionInputs(inputs, config);
    expect(masked.publicGameState).toEqual({ selfHealth: 0.7 });
    expect(masked.matchContext).toEqual(inputs.matchContext);
  });
});

describe('AwarenessUsed tracking', () => {
  it('records specific dimensions/patterns actually read', () => {
    const inputs = baseDecisionInputs({
      awarenessBudget: 0.95,
      semanticProfile: [{ dimension: 'aggression', gameId: 'g1', value: 0.8, confidence: 0.7, samples: 20 }],
      patterns: [{ patternId: 'p:1', detectorId: 'd', patternKey: 'k', category: 'movement', state: 'confirmed', confidence: 0.7, description: 'x' }],
    });
    const { masked, tier } = maskDecisionInputs(inputs, config);
    const acc = createAwarenessAccumulator(tier, inputs.awarenessBudget, masked);

    readSemanticDimension(masked, acc, 'aggression');
    readPatterns(masked, acc, () => true);

    const frozen = freezeAwarenessUsed(acc);
    expect(frozen.semanticDimensionsRead).toEqual(['aggression']);
    expect(frozen.patternIdsRead).toEqual(['p:1']);
  });
});
