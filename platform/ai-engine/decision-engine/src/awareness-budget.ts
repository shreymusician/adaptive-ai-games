/**
 * Awareness Budget at the Decision Engine layer — ADAPTIVE_AI_ENGINE_WHITEPAPER.md
 * §7: "gating how much of the Player Profile/Pattern Recognition/Strategy
 * Planner's read the Decision Engine is permitted to act on."
 *
 * This is a SEPARATE application of the same tier mechanism
 * @adaptive-ai/strategy-planner already implements — Strategy Planner
 * masked its OWN inputs when it built the StrategicIntent this engine
 * receives, but this engine ALSO receives raw semanticProfile/patterns
 * directly per this phase's input list, so it must independently mask
 * them too. "If the budget hides information, the Decision Engine must
 * behave as though it never learned it" — enforced here exactly the same
 * way Strategy Planner enforces it: the masked arrays are genuinely empty
 * below the tier that unlocks them, never merely "hidden" by convention.
 */

import { AwarenessBudgetConfig } from './config';
import { AwarenessTier, AwarenessUsed, AwarenessUsedAccumulator, DecisionInputs, MaskedDecisionInputs, PatternEntry, SemanticProfileEntry } from './types';

/**
 * Deliberately reimplemented rather than imported from
 * @adaptive-ai/strategy-planner: same tiny, dependency-free-primitive
 * convention every AI-engine package's logger.ts already follows (these are
 * peer leaf packages; a shared-utils package isn't worth the indirection
 * for one three-line function), and it sidesteps a structural type
 * mismatch between the two packages' independently-configurable
 * AwarenessBudgetConfig shapes.
 */
export function computeAwarenessTier(budget: number, config: AwarenessBudgetConfig): AwarenessTier {
  if (budget < config.recentOnlyMaxBudget) return 'beginner';
  if (budget < config.semanticProfileMaxBudget) return 'veteran';
  return 'expert';
}

export function maskDecisionInputs(inputs: DecisionInputs, config: AwarenessBudgetConfig): { masked: MaskedDecisionInputs; tier: AwarenessTier } {
  const tier = computeAwarenessTier(inputs.awarenessBudget, config);

  const semanticProfile = tier === 'beginner' ? [] : inputs.semanticProfile;
  const patterns = tier === 'expert' ? inputs.patterns.filter((p) => p.state === 'confirmed' || p.state === 'strong') : [];

  return {
    tier,
    masked: {
      strategicIntent: inputs.strategicIntent,
      matchContext: inputs.matchContext,
      publicGameState: inputs.publicGameState,
      semanticProfile,
      patterns,
      awarenessBudget: inputs.awarenessBudget,
      personality: inputs.personality,
    },
  };
}

export function createAwarenessAccumulator(tier: AwarenessTier, budget: number, masked: MaskedDecisionInputs): AwarenessUsedAccumulator {
  return {
    tier,
    budget,
    usedSemanticProfile: masked.semanticProfile.length > 0,
    usedPatterns: masked.patterns.length > 0,
    semanticDimensionsRead: new Set(),
    patternIdsRead: new Set(),
  };
}

export function freezeAwarenessUsed(acc: AwarenessUsedAccumulator): AwarenessUsed {
  return {
    tier: acc.tier,
    budget: acc.budget,
    usedSemanticProfile: acc.usedSemanticProfile,
    usedPatterns: acc.usedPatterns,
    semanticDimensionsRead: [...acc.semanticDimensionsRead].sort(),
    patternIdsRead: [...acc.patternIdsRead].sort(),
  };
}

export function readSemanticDimension(masked: MaskedDecisionInputs, acc: AwarenessUsedAccumulator, dimension: string): SemanticProfileEntry | undefined {
  const entry = masked.semanticProfile.find((d) => d.dimension === dimension);
  if (entry) acc.semanticDimensionsRead.add(entry.dimension);
  return entry;
}

export function readPatterns(masked: MaskedDecisionInputs, acc: AwarenessUsedAccumulator, predicate: (p: PatternEntry) => boolean): PatternEntry[] {
  const matches = masked.patterns.filter(predicate);
  for (const p of matches) acc.patternIdsRead.add(p.patternId);
  return matches;
}
