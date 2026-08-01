import { CanonicalEvent } from '@adaptive-ai/sdk-protocol';

/** The request body for POST /api/events/batch */
export interface EventBatchRequest {
  events: Array<{
    type: string;
    payload: Record<string, unknown>;
    ts?: number;
    seq: number;
  }>;
}

/** Stored gameplay event with server-side metadata */
export interface StoredEvent extends CanonicalEvent {
  eventId: string;
  serverTs: number;
  validationStatus: 'valid' | 'warning';
  sourcePlugin: string;
}

/** Batch processing result */
export interface EventBatchResult {
  batchId: string;
  matchId: string;
  eventCount: number;
  accepted: number;
  rejected: number;
  errors: Array<{ index: number; seq: number; error: string }>;
}

/** Match context for event authentication */
export interface MatchToken {
  matchId: string;
  playerId: string;
  gameId: string;
  iat: number;
  exp: number;
}

/** Event ordering state */
export interface SequenceState {
  matchId: string;
  lastSeq: number;
  expectedNext: number;
  gapCount: number;
  outOfOrderCount: number;
}

/** Pipeline health status */
export interface PipelineHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  database: {
    connected: boolean;
    latencyMs: number;
  };
  queue: {
    depth: number;
    oldestBatchAgeMs?: number;
  };
  lastEventProcessed?: {
    matchId: string;
    eventId: string;
    timestamp: Date;
  };
}

/** Metrics snapshot */
export interface PipelineMetrics {
  timestamp: Date;
  eventsProcessed: number;
  eventsValid: number;
  eventsDuplicate: number;
  eventsOutOfOrder: number;
  validationErrors: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
}
