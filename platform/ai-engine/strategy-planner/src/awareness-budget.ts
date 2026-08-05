/**
 * Awareness Budget — ADAPTIVE_AI_ENGINE_WHITEPAPER.md §7.
 *
 * "A scalar, 0-1, per match, gating how much of the Player Profile/Pattern
 * Recognition/Strategy Planner's read the Decision Engine is permitted to
 * act on." At this layer (Strategy Planner), the budget gates which of the
 * seven legal PlanningInputs categories a goal is even allowed to read:
 *
 *   Beginner  (budget < recentOnlyMaxBudget)     -> public game state only
 *   Veteran   (budget < semanticProfileMaxBudget) -> + Semantic Profile
 *   Expert    (budget >= semanticProfileMaxBudget) -> + confirmed/strong
 *                                                      Patterns + Episodic Memory
 *
 * `MatchContext` and `PublicGameState` are never gated — they are the
 * "what's happening right now" layer every tier can see (the whitepaper's
 * "falls back to a competent-but-generic baseline that only reacts to
 * Working Memory" framing), never the *learned* knowledge the budget exists
 * to gate.
 *
 * The budget VALUE itself is computed by the caller (a future Difficulty
 * Calibration module) — this file only interprets an already-given budget
 * into a tier and a masked view of the inputs. It never invents a budget.
 */

import { StrategyPlannerConfig } from './config';
import {
  AwarenessTier,
  AwarenessUsed,
  AwarenessUsedAccumulator,
  EpisodicMemoryEntry,
  PatternEntry,
  PlanningInputs,
  SemanticProfileEntry,
} from './types';

const PATTERN_STATE_RANK: Record<PatternEntry['state'], number> = {
  retired: 0,
  candidate: 1,
  weakening: 1,
  confirmed: 2,
  strong: 3,
};

export function computeAwarenessTier(budget: number, config: StrategyPlannerConfig['awarenessBudget']): AwarenessTier {
  if (budget < config.recentOnlyMaxBudget) return 'beginner';
  if (budget < config.semanticProfileMaxBudget) return 'veteran';
  return 'expert';
}

/** The masked subset of PlanningInputs a goal is permitted to read this run — semanticProfile/patterns/episodicMemory are empty arrays below the tier that unlocks them, never merely "hidden" by convention. */
export interface MaskedPlanningInputs {
  matchContext: PlanningInputs['matchContext'];
  publicGameState: PlanningInputs['publicGameState'];
  semanticProfile: SemanticProfileEntry[];
  patterns: PatternEntry[];
  episodicMemory: EpisodicMemoryEntry[];
  awarenessBudget: number;
  personality: PlanningInputs['personality'];
}

export function maskPlanningInputs(inputs: PlanningInputs, config: StrategyPlannerConfig['awarenessBudget']): { masked: MaskedPlanningInputs; tier: AwarenessTier } {
  const tier = computeAwarenessTier(inputs.awarenessBudget, config);

  const semanticProfile = tier === 'beginner' ? [] : inputs.semanticProfile;

  const minRank = PATTERN_STATE_RANK[config.minPatternStateForExpertTier];
  const patterns = tier === 'expert' ? inputs.patterns.filter((p) => PATTERN_STATE_RANK[p.state] >= minRank) : [];
  const episodicMemory = tier === 'expert' ? inputs.episodicMemory : [];

  return {
    tier,
    masked: {
      matchContext: inputs.matchContext,
      publicGameState: inputs.publicGameState,
      semanticProfile,
      patterns,
      episodicMemory,
      awarenessBudget: inputs.awarenessBudget,
      personality: inputs.personality,
    },
  };
}

export function createAwarenessAccumulator(tier: AwarenessTier, budget: number, masked: MaskedPlanningInputs): AwarenessUsedAccumulator {
  return {
    tier,
    budget,
    usedRecentObservations: true, // publicGameState/matchContext are always available and always factored into world-state derivation
    usedSemanticProfile: masked.semanticProfile.length > 0,
    usedPatterns: masked.patterns.length > 0,
    usedEpisodicMemory: masked.episodicMemory.length > 0,
    semanticDimensionsRead: new Set(),
    patternIdsRead: new Set(),
    episodeIdsRead: new Set(),
  };
}

export function freezeAwarenessUsed(acc: AwarenessUsedAccumulator): AwarenessUsed {
  return {
    tier: acc.tier,
    budget: acc.budget,
    usedRecentObservations: acc.usedRecentObservations,
    usedSemanticProfile: acc.usedSemanticProfile,
    usedPatterns: acc.usedPatterns,
    usedEpisodicMemory: acc.usedEpisodicMemory,
    semanticDimensionsRead: [...acc.semanticDimensionsRead].sort(),
    patternIdsRead: [...acc.patternIdsRead].sort(),
    episodeIdsRead: [...acc.episodeIdsRead].sort(),
  };
}

// ---------------------------------------------------------------------------
// Read helpers — goals call these instead of touching masked arrays
// directly, so every genuine read is automatically recorded into
// AwarenessUsed for Explainability, without each of the fourteen goal files
// needing to remember to do the bookkeeping itself.
// ---------------------------------------------------------------------------

/**
 * By default matches a dimension by name regardless of game scope — the
 * caller (a future orchestrator) is responsible for populating
 * PlanningInputs.semanticProfile with only the entries relevant to this
 * match (the current game's own dimensions plus any cross-game ones), so a
 * goal reading "aggression" should find it whether Memory Engine happens to
 * have scoped that particular dimension per-game or cross-game. Pass an
 * explicit `gameId` only when a goal genuinely needs to distinguish between
 * a per-game and a cross-game reading of the SAME dimension name.
 */
export function readSemanticDimension(masked: MaskedPlanningInputs, acc: AwarenessUsedAccumulator, dimension: string, gameId?: string | null): SemanticProfileEntry | undefined {
  const entry = masked.semanticProfile.find((d) => d.dimension === dimension && (gameId === undefined || d.gameId === gameId));
  if (entry) acc.semanticDimensionsRead.add(entry.dimension);
  return entry;
}

export function readPatterns(masked: MaskedPlanningInputs, acc: AwarenessUsedAccumulator, predicate: (p: PatternEntry) => boolean): PatternEntry[] {
  const matches = masked.patterns.filter(predicate);
  for (const p of matches) acc.patternIdsRead.add(p.patternId);
  return matches;
}

export function readEpisodes(masked: MaskedPlanningInputs, acc: AwarenessUsedAccumulator, predicate: (e: EpisodicMemoryEntry) => boolean): EpisodicMemoryEntry[] {
  const matches = masked.episodicMemory.filter(predicate);
  for (const e of matches) acc.episodeIdsRead.add(e.episodeId);
  return matches;
}
