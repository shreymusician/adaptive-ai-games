import { describe, it, expect } from 'vitest';
import { computeAwarenessTier, createAwarenessAccumulator, freezeAwarenessUsed, maskPlanningInputs, readPatterns, readSemanticDimension } from '../awareness-budget';
import { loadStrategyPlannerConfig } from '../config';
import { baseInputs } from './fixtures';

const config = loadStrategyPlannerConfig().awarenessBudget;

describe('computeAwarenessTier', () => {
  it('maps low budget to beginner', () => {
    expect(computeAwarenessTier(0.1, config)).toBe('beginner');
  });
  it('maps mid budget to veteran', () => {
    expect(computeAwarenessTier(0.5, config)).toBe('veteran');
  });
  it('maps high budget to expert', () => {
    expect(computeAwarenessTier(0.95, config)).toBe('expert');
  });
  it('is monotonic across the full [0,1] range', () => {
    const tiers = ['beginner', 'veteran', 'expert'];
    let lastRank = -1;
    for (let b = 0; b <= 1; b += 0.05) {
      const rank = tiers.indexOf(computeAwarenessTier(b, config));
      expect(rank).toBeGreaterThanOrEqual(lastRank);
      lastRank = rank;
    }
  });
});

describe('maskPlanningInputs — whitepaper §7 worked examples', () => {
  const profile = [{ dimension: 'aggression', gameId: 'g1', value: 0.8, confidence: 0.7, samples: 20 }];
  const patterns = [{ patternId: 'p:1', detectorId: 'd', patternKey: 'k', category: 'movement', state: 'confirmed' as const, confidence: 0.7, description: 'x' }];
  const episodes = [{ episodeId: 'e1', episodeType: 'important-mistake', summary: 'x', importance: 0.8, confidence: 0.6, timestamp: 1 }];

  it('Beginner: uses only public game state — semantic profile, patterns, episodic memory all withheld', () => {
    const inputs = baseInputs({ awarenessBudget: 0.1, semanticProfile: profile, patterns, episodicMemory: episodes, publicGameState: { selfHealth: 0.9 } });
    const { masked, tier } = maskPlanningInputs(inputs, config);
    expect(tier).toBe('beginner');
    expect(masked.semanticProfile).toEqual([]);
    expect(masked.patterns).toEqual([]);
    expect(masked.episodicMemory).toEqual([]);
    expect(masked.publicGameState).toEqual({ selfHealth: 0.9 }); // never gated
  });

  it('Veteran: adds Semantic Profile, patterns/episodic memory still withheld', () => {
    const inputs = baseInputs({ awarenessBudget: 0.5, semanticProfile: profile, patterns, episodicMemory: episodes });
    const { masked, tier } = maskPlanningInputs(inputs, config);
    expect(tier).toBe('veteran');
    expect(masked.semanticProfile).toEqual(profile);
    expect(masked.patterns).toEqual([]);
    expect(masked.episodicMemory).toEqual([]);
  });

  it('Expert: adds confirmed/strong Patterns + Episodic Memory on top of Semantic Profile', () => {
    const inputs = baseInputs({ awarenessBudget: 0.95, semanticProfile: profile, patterns, episodicMemory: episodes });
    const { masked, tier } = maskPlanningInputs(inputs, config);
    expect(tier).toBe('expert');
    expect(masked.semanticProfile).toEqual(profile);
    expect(masked.patterns).toEqual(patterns);
    expect(masked.episodicMemory).toEqual(episodes);
  });

  it('Expert tier filters out non-confirmed/strong patterns (candidate/weakening/retired never surface)', () => {
    const weakPatterns = [
      { patternId: 'p:1', detectorId: 'd', patternKey: 'k1', category: 'movement', state: 'candidate' as const, confidence: 0.3, description: 'x' },
      { patternId: 'p:2', detectorId: 'd', patternKey: 'k2', category: 'movement', state: 'strong' as const, confidence: 0.9, description: 'y' },
    ];
    const inputs = baseInputs({ awarenessBudget: 0.95, patterns: weakPatterns });
    const { masked } = maskPlanningInputs(inputs, config);
    expect(masked.patterns).toHaveLength(1);
    expect(masked.patterns[0].patternKey).toBe('k2');
  });
});

describe('AwarenessUsed tracking', () => {
  it('records which specific dimensions/patterns/episodes a goal actually read', () => {
    const inputs = baseInputs({
      awarenessBudget: 0.95,
      semanticProfile: [{ dimension: 'aggression', gameId: 'g1', value: 0.8, confidence: 0.7, samples: 20 }],
      patterns: [{ patternId: 'p:1', detectorId: 'd', patternKey: 'k', category: 'movement', state: 'confirmed', confidence: 0.7, description: 'x' }],
    });
    const { masked, tier } = maskPlanningInputs(inputs, config);
    const acc = createAwarenessAccumulator(tier, inputs.awarenessBudget, masked);

    readSemanticDimension(masked, acc, 'aggression');
    readPatterns(masked, acc, () => true);

    const frozen = freezeAwarenessUsed(acc);
    expect(frozen.semanticDimensionsRead).toEqual(['aggression']);
    expect(frozen.patternIdsRead).toEqual(['p:1']);
    expect(frozen.tier).toBe('expert');
  });

  it('never reports usedSemanticProfile/usedPatterns/usedEpisodicMemory true when nothing of that kind is unlocked', () => {
    const inputs = baseInputs({ awarenessBudget: 0.1 });
    const { masked, tier } = maskPlanningInputs(inputs, config);
    const acc = createAwarenessAccumulator(tier, inputs.awarenessBudget, masked);
    const frozen = freezeAwarenessUsed(acc);
    expect(frozen.usedSemanticProfile).toBe(false);
    expect(frozen.usedPatterns).toBe(false);
    expect(frozen.usedEpisodicMemory).toBe(false);
  });
});
