export { StrategyPlanner } from './strategy-planner';
export type { StrategyPlannerOptions } from './strategy-planner';

export { GoalRegistry } from './registry';
export type { GoalExecutionOutcome } from './registry';

export { BaseGoal } from './goal';
export type { Goal, GoalFactory } from './goal';

export { PlanCache, checkCacheValidity, findInterruptingGoal, fingerprintWorldState } from './plan-cache';
export type { CachedPlanEntry, CacheValidity } from './plan-cache';

export { runGoapSearch } from './goap-planner';
export type { GoapSearchResult } from './goap-planner';

export { buildWorldState, applyEffects } from './world-state';

export { computeAwarenessTier, maskPlanningInputs, createAwarenessAccumulator, freezeAwarenessUsed, readSemanticDimension, readPatterns, readEpisodes } from './awareness-budget';
export type { MaskedPlanningInputs } from './awareness-budget';

export { resolvePersonalityWeight, explorationEpsilon, seededUnitRandom } from './personality';

export { loadStrategyPlannerConfig } from './config';
export type { StrategyPlannerConfig, AwarenessBudgetConfig, PersonalityConfig, PersonalityProfile, CategoryWeights, GoapConfig } from './config';

export { Logger, ConsoleLogSink, MemoryLogSink, rootLogger } from './logger';
export type { LogLevel, LogSink, LogFields } from './logger';

export {
  StrategyPlannerError,
  DuplicateGoalError,
  UnknownGoalDependencyError,
  CyclicGoalDependencyError,
  UnknownGoalError,
  NoEligibleGoalError,
  isStrategyPlannerError,
} from './errors';

export { clamp, mean, fnv1a, fingerprintFacts } from './stats';

export {
  PERSONALITY_ARCHETYPES,
  isPersonalityArchetype,
} from './types';
export type {
  SemanticProfileEntry,
  PatternEntry,
  EpisodicMemoryEntry,
  MatchContext,
  PublicGameState,
  PersonalityArchetype,
  PlanningInputs,
  WorldFactValue,
  AbstractWorldState,
  GoalCategory,
  GoalMetadata,
  GoalEvaluationContext,
  GoalEvaluationResult,
  AwarenessTier,
  AwarenessUsedAccumulator,
  AwarenessUsed,
  GoalCandidateTrace,
  PlanStepTrace,
  PlanningTrace,
  PlanningMetadata,
  GoalConfidence,
  StrategicIntent,
} from './types';

export {
  PressurePlayerGoal,
  ForceMovementGoal,
  ForceReloadGoal,
  ControlSpaceGoal,
  DenyResourcesGoal,
  CreateAmbushGoal,
  BreakPredictablePatternGoal,
  ScoutUnknownBehaviorGoal,
  ProtectObjectiveGoal,
  RetreatGoal,
  RegroupGoal,
  DelayEngagementGoal,
  SplitTargetsGoal,
  TestHypothesisGoal,
  registerAllGoals,
} from './goals';
