import { loadStrategyPlannerConfig, StrategyPlannerConfig } from '../config';
import { GoalRegistry } from '../registry';
import { registerAllGoals } from '../goals';
import { StrategyPlanner } from '../strategy-planner';
import { AbstractWorldState, AwarenessUsedAccumulator, GoalEvaluationContext, PlanningInputs } from '../types';

export function baseInputs(overrides: Partial<PlanningInputs> = {}): PlanningInputs {
  return {
    matchContext: { matchId: 'match-1', playerId: 'player-1', gameId: 'game-1', elapsedMs: 10_000 },
    publicGameState: {},
    semanticProfile: [],
    patterns: [],
    episodicMemory: [],
    awarenessBudget: 0.9,
    personality: 'aggressive',
    ...overrides,
  };
}

export function buildRegistry(): GoalRegistry {
  const registry = new GoalRegistry();
  registerAllGoals(registry);
  return registry;
}

export function buildConfig(overrides: Partial<StrategyPlannerConfig> = {}): StrategyPlannerConfig {
  return loadStrategyPlannerConfig(overrides);
}

export function buildPlanner(configOverrides: Partial<StrategyPlannerConfig> = {}): StrategyPlanner {
  return new StrategyPlanner({ registry: buildRegistry(), config: buildConfig(configOverrides) });
}

export function makeAwarenessAccumulator(overrides: Partial<AwarenessUsedAccumulator> = {}): AwarenessUsedAccumulator {
  return {
    tier: 'expert',
    budget: 0.9,
    usedRecentObservations: true,
    usedSemanticProfile: true,
    usedPatterns: true,
    usedEpisodicMemory: true,
    semanticDimensionsRead: new Set(),
    patternIdsRead: new Set(),
    episodeIdsRead: new Set(),
    ...overrides,
  };
}

/** Builds a GoalEvaluationContext directly from a hand-written AbstractWorldState — for testing one goal's evaluate() in isolation, bypassing the full masking/world-state-building pipeline. */
export function makeGoalCtx(worldState: AbstractWorldState, overrides: Partial<PlanningInputs> = {}): GoalEvaluationContext {
  return {
    inputs: baseInputs(overrides),
    worldState,
    awarenessUsed: makeAwarenessAccumulator(),
    siblingResults: new Map(),
  };
}
