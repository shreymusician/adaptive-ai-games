export { PlayerModelingEngine } from './player-modeling-engine';
export type { PlayerModelingEngineOptions } from './player-modeling-engine';

export { DimensionRegistry } from './registry';
export type { AnalyzerExecutionOutcome } from './registry';

export { BaseDimensionAnalyzer, BaseCategoricalAnalyzer } from './analyzer';
export type { DimensionAnalyzer, DimensionAnalyzerFactory } from './analyzer';

export { loadPlayerModelingConfig, resolveTuning } from './config';
export type { PlayerModelingConfig, DimensionTuning } from './config';

export { Logger, ConsoleLogSink, MemoryLogSink, rootLogger } from './logger';
export type { LogLevel, LogSink, LogFields } from './logger';

export {
  PlayerModelingError,
  DuplicateAnalyzerError,
  UnknownDependencyError,
  CyclicDependencyError,
  UnknownAnalyzerError,
  MatchNotCommittedError,
  isPlayerModelingError,
} from './errors';

export type {
  DimensionSnapshotInput,
  DimensionObservationEntry,
  DimensionAnalyzerResult,
  DimensionKind,
  DimensionScope,
  DimensionAnalyzerMetadata,
  AnalyzerRunContext,
  CommittedDimensionUpdate,
  SkippedDimension,
  AnalyzerFailure,
  EpisodeCandidate,
  PlayerModelingRunResult,
} from './types';
export { priorProfileKey } from './types';

export {
  ReactionTimeAnalyzer,
  DecisionSpeedAnalyzer,
  AggressionAnalyzer,
  RiskToleranceAnalyzer,
  ConsistencyAnalyzer,
  PredictabilityAnalyzer,
  LearningRateAnalyzer,
  MechanicalSkillAnalyzer,
  StrategicSkillAnalyzer,
  ExplorationAnalyzer,
  PreferredCombatDistanceAnalyzer,
  PreferredStrategiesAnalyzer,
  PlayerConfidenceAnalyzer,
  registerAllAnalyzers,
} from './analyzers';

export { mean, variance, entropy, normalizedEntropy, clamp } from './stats';
