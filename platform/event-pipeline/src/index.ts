export { EventStore } from './event-store';
export { EventProcessor } from './event-processor';
export { validateEvent, validateBatch, validateSequencing } from './validation';
export type {
  EventBatchRequest,
  StoredEvent,
  EventBatchResult,
  MatchToken,
  SequenceState,
  PipelineHealth,
  PipelineMetrics,
} from './types';
