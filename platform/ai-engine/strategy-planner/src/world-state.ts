/**
 * WorldStateBuilder — derives the GOAP search space (AbstractWorldState)
 * from awareness-masked PlanningInputs. Purely symbolic, purely
 * deterministic: the same masked inputs always produce the same facts.
 *
 * New goals that need a new fact add it here (and only here) — the GOAP
 * planner itself never knows what a fact "means", it only simulates effects
 * against whatever keys exist (whitepaper's "future goals should require no
 * changes to existing planner code" — this file is the one narrow exception
 * a genuinely new SIGNAL (not a new goal) requires touching, exactly like
 * player-modeling's config.ts is where a genuinely new threshold lives).
 */

import { StrategyPlannerConfig } from './config';
import { AbstractWorldState, AwarenessUsedAccumulator } from './types';
import { MaskedPlanningInputs, readSemanticDimension, readPatterns, readEpisodes } from './awareness-budget';
import { clamp } from './stats';

export function buildWorldState(masked: MaskedPlanningInputs, acc: AwarenessUsedAccumulator, config: StrategyPlannerConfig): AbstractWorldState {
  const { thresholds, facts } = { thresholds: config.worldStateThresholds, facts: {} as Record<string, boolean | number> };

  // --- Public game state (always available, every awareness tier) ---
  const gs = masked.publicGameState;
  if (gs.selfHealth !== undefined) {
    facts.selfHealth = gs.selfHealth;
    facts.selfHealthLow = gs.selfHealth < thresholds.healthLow;
  }
  if (gs.playerHealthVisible !== undefined) {
    facts.playerHealthVisible = gs.playerHealthVisible;
    facts.playerHealthLow = gs.playerHealthVisible < thresholds.healthLow;
  }
  if (gs.spaceContested !== undefined) {
    facts.spaceContestedValue = gs.spaceContested;
    facts.spaceContested = gs.spaceContested >= thresholds.spaceContested;
  }
  if (gs.selfResourcesLow !== undefined) {
    facts.selfResourcesLowValue = gs.selfResourcesLow;
    facts.selfResourcesLow = gs.selfResourcesLow >= thresholds.resourcesLow;
  }
  facts.objectiveThreatened = gs.objectiveThreatened === true;
  facts.playerRetreating = gs.playerRetreating === true;
  facts.openingAvailable = gs.openingAvailable === true;
  for (const [key, value] of Object.entries(gs.extra ?? {})) {
    facts[`extra_${key}`] = value;
  }

  // --- Semantic Profile (veteran+ tier) ---
  const predictability = readSemanticDimension(masked, acc, 'predictability');
  facts.playerPredictable = predictability !== undefined && predictability.value >= 0.5 && predictability.confidence >= thresholds.predictabilityHighConfidence;

  const riskTolerance = readSemanticDimension(masked, acc, 'riskTolerance');
  facts.playerHighRiskTolerance = riskTolerance !== undefined && riskTolerance.value >= thresholds.highRiskTolerance;

  const aggression = readSemanticDimension(masked, acc, 'aggression');
  facts.playerHighAggression = aggression !== undefined && aggression.value >= thresholds.highAggression;

  const mechanicalSkill = readSemanticDimension(masked, acc, 'mechanicalSkill');
  facts.playerLowMechanicalSkill = mechanicalSkill !== undefined && mechanicalSkill.value <= thresholds.lowMechanicalSkill;

  const playerConfidence = readSemanticDimension(masked, acc, 'confidence');
  facts.playerLowConfidence = playerConfidence !== undefined && playerConfidence.value <= 0.4 && playerConfidence.confidence >= 0.3;

  facts.semanticProfileAvailable = masked.semanticProfile.length > 0;

  // --- Patterns (expert tier, already filtered to confirmed/strong) ---
  const exploitablePatterns = readPatterns(masked, acc, () => true);
  facts.hasExploitablePattern = exploitablePatterns.length > 0;
  facts.exploitablePatternCount = exploitablePatterns.length;
  const categoryCounts = new Map<string, number>();
  for (const p of exploitablePatterns) categoryCounts.set(p.category, (categoryCounts.get(p.category) ?? 0) + 1);
  for (const [category, count] of categoryCounts) {
    facts[`patternCategory_${category}`] = true;
    facts[`patternCategory_${category}_count`] = count;
  }

  // --- Episodic Memory (expert tier) ---
  const notableEpisodes = readEpisodes(masked, acc, (e) => e.importance >= 0.5);
  facts.hasNotableEpisode = notableEpisodes.length > 0;
  const mistakeEpisodes = readEpisodes(masked, acc, (e) => e.episodeType === 'repeated-trap' || e.episodeType === 'important-mistake');
  facts.hasRepeatedMistakeEpisode = mistakeEpisodes.length > 0;

  // --- Derived / tier flags ---
  facts.awarenessTierBeginner = acc.tier === 'beginner';
  facts.awarenessTierVeteran = acc.tier === 'veteran';
  facts.awarenessTierExpert = acc.tier === 'expert';
  facts.awarenessBudget = clamp(masked.awarenessBudget, 0, 1);

  return Object.freeze(facts);
}

/** Applies a Goal's declared expectedEffects on top of a world state, producing the next planning step's state — pure, used only by the GOAP forward search's simulation. */
export function applyEffects(state: AbstractWorldState, effects: AbstractWorldState): AbstractWorldState {
  return Object.freeze({ ...state, ...effects });
}
