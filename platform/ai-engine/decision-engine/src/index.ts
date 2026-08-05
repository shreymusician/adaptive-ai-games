export { DecisionEngine } from './decision-engine';
export type { DecisionEngineOptions } from './decision-engine';

export { DecisionRegistry } from './registry';
export type { ConsiderationExecutionOutcome } from './registry';

export { BaseConsideration } from './consideration';
export type { Consideration, ConsiderationFactory } from './consideration';

export { evaluateAction } from './evaluator';
export { selectBestAction } from './selector';
export type { SelectionResult } from './selector';

export { buildWorldFacts } from './world-facts';

export { computeAwarenessTier, maskDecisionInputs, createAwarenessAccumulator, freezeAwarenessUsed, readSemanticDimension, readPatterns } from './awareness-budget';

export { resolvePersonalityWeight, explorationEpsilon, seededUnitRandom } from './personality';

export { loadDecisionEngineConfig } from './config';
export type { DecisionEngineConfig, AwarenessBudgetConfig, PersonalityConfig, PersonalityProfile, CategoryWeights, WorldFactThresholds } from './config';

export { Logger, ConsoleLogSink, MemoryLogSink, rootLogger } from './logger';
export type { LogLevel, LogSink, LogFields } from './logger';

export {
  DecisionEngineError,
  DuplicateConsiderationError,
  UnknownConsiderationDependencyError,
  CyclicConsiderationDependencyError,
  UnknownConsiderationError,
  NoLegalActionsError,
  MalformedLegalActionsError,
  InvalidStrategicIntentError,
  isDecisionEngineError,
} from './errors';

export { clamp } from './stats';

export type {
  Action,
  StrategicIntent,
  SemanticProfileEntry,
  PatternEntry,
  MatchContext,
  PublicGameState,
  PersonalityArchetype,
  AwarenessTier,
  GoalCategory,
  DecisionInputs,
  ConsiderationCategory,
  ConsiderationMetadata,
  DecisionFactValue,
  DecisionWorldFacts,
  AwarenessUsedAccumulator,
  AwarenessUsed,
  MaskedDecisionInputs,
  ConsiderationContext,
  ConsiderationResult,
  ActionScore,
  DecisionScore,
  AlternativeCandidate,
  TieBreakMode,
  DecisionMetadata,
  ReasoningTrace,
  Decision,
} from './types';

export { PlanAdherenceConsideration, PunishOpeningConsideration, SafetyConsideration, PatternExploitConsideration, ProfileExploitConsideration, ActionFreshnessConsideration, registerAllConsiderations } from './considerations';
