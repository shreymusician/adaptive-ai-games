export { MemoryEngine } from './memory-engine';
export type { MemoryEngineOptions, StoreWorkingMemoryInput, LoadPlayerMemoryOptions } from './memory-engine';

export { WorkingMemoryStore } from './working-memory-store';
export { ShortTermMemoryStore } from './short-term-memory-store';
export { SemanticMemoryStore } from './semantic-memory-store';
export { EpisodicMemoryStore } from './episodic-memory-store';

export { applyObservation, asymptoticConfidence, decayConfidence, UNOBSERVED_DIMENSION } from './confidence';
export type { DimensionSnapshot } from './confidence';

export { loadMemoryEngineConfig } from './config';
export type { MemoryEngineConfig, ConfidenceConfig, WorkingMemoryConfig, ShortTermMemoryConfig, EpisodicMemoryConfig } from './config';

export { Logger, ConsoleLogSink, MemoryLogSink, rootLogger } from './logger';
export type { LogLevel, LogSink, LogFields } from './logger';

export {
  MemoryEngineError,
  WorkingMemoryNotFoundError,
  ShortTermMemoryNotFoundError,
  SemanticWriteConflictError,
  SemanticVersionNotFoundError,
  InvalidEpisodeError,
  isMemoryEngineError,
} from './errors';

export type {
  WorkingMemoryObservation,
  WorkingMemoryState,
  ShortTermEventRef,
  ShortTermBehaviorObservation,
  ShortTermDecisionRef,
  ShortTermMemoryState,
  MatchMemoryRecord,
  GameScope,
  SemanticDimensionState,
  SemanticDimensionVersion,
  UpdateSemanticMemoryInput,
  EpisodeType,
  PlayerEpisode,
  StoreEpisodeInput,
  EpisodeSearchCriteria,
  PlayerMemorySnapshot,
} from './types';
