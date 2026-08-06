export { ExplainabilityEngine } from './explainability-engine';
export type { ExplainabilityEngineOptions } from './explainability-engine';

export { ExplanationStore } from './explanation-store';
export type { ExplanationDocument, ExplanationQuery } from './explanation-store';

export { createExplainabilityRouter } from './router';
export type { ExplainabilityRouterDeps } from './router';

export { explainDecision } from './decision-explainer';
export { explainStrategy } from './strategy-explainer';
export { explainPattern } from './pattern-explainer';
export { explainPlayerProfile } from './profile-explainer';
export { explainEpisode } from './episode-explainer';
export { summarizeMatch } from './match-summary';
export { computeBehaviorEvolution, computeTrendDirection } from './behavior-evolution';
export { computeConfidenceEvolution } from './confidence-evolution';
export { compareMatches } from './match-comparison';
export { generatePlayerInsights } from './player-insights';
export type { PlayerInsightsInputs } from './player-insights';

export { confidenceLevel, confidenceReading } from './confidence';
export { evidence, traceEntry, TraceabilityBuilder } from './evidence';
export * as templates from './templates';

export { loadExplainabilityConfig } from './config';
export type { ExplainabilityConfig, ConfidenceBucketConfig, TrendConfig, DimensionPolarity, DimensionPolarityMap } from './config';

export { Logger, ConsoleLogSink, MemoryLogSink, rootLogger } from './logger';
export type { LogLevel, LogSink, LogFields } from './logger';

export {
  ExplainabilityError,
  MissingReasoningDataError,
  IntentDecisionMismatchError,
  MalformedDecisionTraceError,
  MalformedPlanningTraceError,
  InsufficientHistoryError,
  EmptyDecisionSetError,
  InconsistentMatchDataError,
  ExplanationNotFoundError,
  isExplainabilityError,
} from './errors';

export type {
  Action,
  AlternativeCandidate,
  AwarenessTier,
  ConsiderationResult,
  Decision,
  DecisionWorldFacts,
  PersonalityArchetype,
  GoalCandidateTrace,
  GoalCategory,
  PatternEntry,
  SemanticProfileEntry,
  StrategicIntent,
  PlayerEpisode,
  SemanticDimensionVersion,
  ExplanationInputs,
  ConfidenceLevel,
  ConfidenceReading,
  EvidenceKind,
  EvidenceRef,
  TraceabilityEntry,
  TraceabilityMap,
  DecisionSummary,
  PrimaryReason,
  SupportingEvidenceItem,
  AlternativeConsidered,
  PatternUsed,
  PlayerTraitUsed,
  MemoryReferenced,
  DecisionExplanation,
  StrategyExplanation,
  PatternExplanation,
  ProfileDimensionExplanation,
  PlayerProfileExplanation,
  EpisodeExplanation,
  GoalCategoryTally,
  DecisionSummaryRef,
  MatchSummary,
  TrendDirection,
  BehaviorEvolution,
  ConfidenceHistoryPoint,
  ConfidenceEvolution,
  DimensionComparison,
  MatchComparison,
  InsightCategory,
  PlayerInsight,
  PlayerInsights,
  AnyExplanation,
  ExplanationType,
  StoredExplanation,
} from './types';
