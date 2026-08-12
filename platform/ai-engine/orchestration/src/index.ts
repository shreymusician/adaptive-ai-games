export { MatchOrchestrator } from './match-orchestrator';
export type { MatchOrchestratorOptions } from './match-orchestrator';

export { OrchestratingEventProcessor } from './orchestrating-processor';
export type { OrchestratedEventBatchResult } from './orchestrating-processor';

export { ReportStore } from './report-store';

export { createDashboardRouter } from './dashboard-router';
export type { DashboardRouterDeps } from './dashboard-router';

export { OrchestrationStack } from './bootstrap';
export type { OrchestrationStackOptions } from './bootstrap';

export { verifyMatchToken, mintMatchToken, loadConfig as loadEventPipelineConfig } from '@adaptive-ai/event-pipeline';
export type { MatchTokenClaims, TokenScope, EventPipelineConfig } from '@adaptive-ai/event-pipeline';

export { loadOrchestrationConfig } from './types';
export type { OrchestrationConfig, MatchProcessingStatus, MatchProcessingReport, MatchCompletedEvent, StageError, IngestableEvent } from './types';

export { Logger, ConsoleLogSink, MemoryLogSink, rootLogger } from './logger';
export type { LogLevel, LogSink, LogFields } from './logger';

export {
  OrchestrationError,
  MatchAlreadyCompletedError,
  MatchNeverStartedError,
  MemoryCommitFailedError,
  isOrchestrationError,
} from './errors';
