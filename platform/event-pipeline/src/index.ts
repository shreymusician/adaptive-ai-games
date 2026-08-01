export { EventStore } from './event-store';
export { EventProcessor } from './event-processor';
export { validateEvent, validateBatch, validateSequencing } from './validation';
export { EventPipeline } from './pipeline';
export type { EventPipelineOptions } from './pipeline';
export { loadConfig } from './config';
export type { EventPipelineConfig } from './config';
export { createEventPipelineRouter } from './router';
export type { RouterDeps } from './router';
export { getHealthReport } from './health';
export type { HealthReport } from './health';
export { MetricsRegistry } from './metrics';
export { Logger, ConsoleLogSink, MemoryLogSink, rootLogger } from './logger';
export type { LogLevel, LogSink, LogFields } from './logger';
export { RateLimiter, rateLimit } from './rate-limiter';
export type { RateLimitKeyFn } from './rate-limiter';
export { mintMatchToken, verifyMatchToken, requireMatchToken, assertMatchAccess, assertPlayerAccess, assertGameAccess } from './auth';
export type { MatchTokenClaims, TokenScope, AuthenticatedRequest } from './auth';
export {
  PipelineError,
  AuthenticationError,
  AuthorizationError,
  ValidationFailedError,
  PayloadTooLargeError,
  RateLimitExceededError,
  NotFoundError,
  ServiceUnavailableError,
  isPipelineError,
} from './errors';
export type {
  EventBatchRequest,
  StoredEvent,
  EventBatchResult,
  MatchToken,
  SequenceState,
  PipelineHealth,
  PipelineMetrics,
} from './types';
