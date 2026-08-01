import { EventStore } from './event-store';
import { MetricsRegistry } from './metrics';
import { EventPipelineConfig } from './config';

export interface HealthReport {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptimeSeconds: number;
  timestamp: string;
  database: {
    connected: boolean;
    latencyMs: number | null;
    error?: string;
  };
  storage: {
    totalEvents: number;
    totalBatches: number;
  };
  lastEventProcessed: {
    matchId: string;
    eventId: string;
    type: string;
    serverTs: number;
  } | null;
  pipeline: {
    eventsProcessed: number;
    validationErrors: number;
    duplicateEvents: number;
    outOfOrderEvents: number;
    rateLimitRejections: number;
    authFailures: number;
    averageBatchLatencyMs: number;
    p95BatchLatencyMs: number;
    p99BatchLatencyMs: number;
  };
}

const DEGRADED_LATENCY_MS = 200;
const UNHEALTHY_LATENCY_MS = 2000;

/**
 * Aggregates database connectivity, storage counters, and pipeline metrics
 * into a single health report. Status rolls up to the worst signal: DB
 * unreachable is always `unhealthy`; high DB latency or an elevated
 * validation-error rate is `degraded`; otherwise `healthy`.
 */
export async function getHealthReport(store: EventStore, metrics: MetricsRegistry, config: EventPipelineConfig): Promise<HealthReport> {
  let dbConnected = true;
  let dbLatencyMs: number | null = null;
  let dbError: string | undefined;

  try {
    dbLatencyMs = await store.ping();
  } catch (err) {
    dbConnected = false;
    dbError = err instanceof Error ? err.message : String(err);
  }

  let totalEvents = 0;
  let totalBatches = 0;
  let lastEvent: HealthReport['lastEventProcessed'] = null;

  if (dbConnected) {
    try {
      const [events, batches, mostRecent] = await Promise.all([
        store.getTotalEventCount(),
        store.getTotalBatchCount(),
        store.getMostRecentEvent(),
      ]);
      totalEvents = events;
      totalBatches = batches;
      if (mostRecent) {
        lastEvent = {
          matchId: mostRecent.matchId,
          eventId: mostRecent.eventId,
          type: mostRecent.type,
          serverTs: mostRecent.serverTs,
        };
      }
    } catch (err) {
      // Storage counters are best-effort; a failure here shouldn't flip an
      // otherwise-healthy DB connection to unhealthy.
      dbError = dbError ?? (err instanceof Error ? err.message : String(err));
    }
  }

  const snapshot = metrics.snapshot();

  let status: HealthReport['status'] = 'healthy';
  if (!dbConnected) {
    status = 'unhealthy';
  } else if (dbLatencyMs !== null && dbLatencyMs > UNHEALTHY_LATENCY_MS) {
    status = 'unhealthy';
  } else if (dbLatencyMs !== null && dbLatencyMs > DEGRADED_LATENCY_MS) {
    status = 'degraded';
  }

  return {
    status,
    version: config.version,
    uptimeSeconds: metrics.uptimeSeconds(),
    timestamp: new Date().toISOString(),
    database: { connected: dbConnected, latencyMs: dbLatencyMs, error: dbError },
    storage: { totalEvents, totalBatches },
    lastEventProcessed: lastEvent,
    pipeline: {
      eventsProcessed: snapshot.eventsProcessed,
      validationErrors: snapshot.validationErrors,
      duplicateEvents: snapshot.eventsDuplicate,
      outOfOrderEvents: snapshot.eventsOutOfOrder,
      rateLimitRejections: metrics.rateLimitRejections.get(),
      authFailures: metrics.authFailures.get(),
      averageBatchLatencyMs: snapshot.averageLatencyMs,
      p95BatchLatencyMs: snapshot.p95LatencyMs,
      p99BatchLatencyMs: snapshot.p99LatencyMs,
    },
  };
}
