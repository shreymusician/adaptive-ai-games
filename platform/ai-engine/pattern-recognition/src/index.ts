export { PatternRecognitionEngine } from './pattern-recognition-engine';
export type { PatternRecognitionEngineOptions } from './pattern-recognition-engine';

export { PatternRegistry } from './registry';
export type { DetectorExecutionOutcome } from './registry';

export { PatternStore } from './pattern-store';
export type { UpsertPatternInput, UpsertPatternOutcome } from './pattern-store';

export { BasePatternDetector } from './detector';
export type { PatternDetector, PatternDetectorFactory } from './detector';

export { nextLifecycleState, isPromotion } from './lifecycle';

export { applyPatternObservation, decayDormantConfidence, UNOBSERVED_PATTERN } from './confidence';

export { loadPatternRecognitionConfig, resolveTuning, healthBand } from './config';
export type { PatternRecognitionConfig } from './config';

export { Logger, ConsoleLogSink, MemoryLogSink, rootLogger } from './logger';
export type { LogLevel, LogSink, LogFields } from './logger';

export {
  PatternRecognitionError,
  DuplicateDetectorError,
  UnknownDetectorDependencyError,
  CyclicDetectorDependencyError,
  UnknownDetectorError,
  MatchNotCommittedError,
  PatternNotFoundError,
  isPatternRecognitionError,
} from './errors';

export type {
  PatternCategory,
  PatternLifecycleState,
  PatternLifecycleThresholds,
  PatternTuning,
  PatternConfidenceState,
  PatternRecord,
  PatternVersion,
  PatternSearchCriteria,
  PatternKeyDelta,
  DetectorResult,
  PatternDetectorMetadata,
  DetectorRunContext,
  PatternTransitionEvent,
  SkippedDetector,
  DetectorFailure,
  PatternRecognitionRunResult,
} from './types';
export { patternId } from './types';

export {
  DodgeDirectionDetector,
  EscapeRoutesDetector,
  CornerPreferenceDetector,
  CircleStrafingDetector,
  ReloadTimingDetector,
  TargetPrioritizationDetector,
  EngagementDistanceDetector,
  WeaponPreferenceDetector,
  RetreatConditionsDetector,
  HealingTimingDetector,
  AbilityUsageTimingDetector,
  ResourceConservationDetector,
  RoutePreferenceDetector,
  RoomClearingDetector,
  ExplorationOrderDetector,
  PushAfterDamageDetector,
  ChaseLowHealthDetector,
  OverextensionDetector,
  registerAllDetectors,
} from './detectors';

export { clamp } from './stats';
