/**
 * Central configuration for the Event Pipeline, sourced from environment
 * variables with safe defaults for local development. Every tunable limit
 * referenced elsewhere in this package should be read from here, not
 * hardcoded at the call site, so operators can retune without a code change.
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envString(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

export interface EventPipelineConfig {
  /** Maximum number of events accepted in a single POST /api/events/batch */
  maxBatchSize: number;
  /** Maximum size (bytes) of a single event payload */
  maxEventPayloadBytes: number;
  /** Maximum size (bytes) of an entire batch request body */
  maxBatchPayloadBytes: number;
  /** How many trailing events (by seq distance) still count as "in the dedup window" */
  deduplicationWindow: number;
  /** Match token: signing secret */
  matchTokenSecret: string;
  /** Match token: default lifetime in seconds, applied at mint time */
  matchTokenTtlSeconds: number;
  /** Rate limit: max batch submissions per match per window */
  rateLimitBatchPerWindow: number;
  /** Rate limit: window size in ms for batch submissions */
  rateLimitBatchWindowMs: number;
  /** Rate limit: max replay/read requests per identity per window */
  rateLimitReadPerWindow: number;
  /** Rate limit: window size in ms for replay/read requests */
  rateLimitReadWindowMs: number;
  /** Default page size for paginated endpoints */
  defaultPageSize: number;
  /** Maximum page size for paginated endpoints */
  maxPageSize: number;
  /** Service version, surfaced on /health */
  version: string;
}

export function loadConfig(overrides: Partial<EventPipelineConfig> = {}): EventPipelineConfig {
  const base: EventPipelineConfig = {
    maxBatchSize: envInt('EVENT_PIPELINE_MAX_BATCH_SIZE', 1000),
    maxEventPayloadBytes: envInt('EVENT_PIPELINE_MAX_EVENT_PAYLOAD_BYTES', 10 * 1024),
    maxBatchPayloadBytes: envInt('EVENT_PIPELINE_MAX_BATCH_PAYLOAD_BYTES', 10 * 1024 * 1024),
    deduplicationWindow: envInt('EVENT_PIPELINE_DEDUP_WINDOW', 10000),
    matchTokenSecret: envString('EVENT_PIPELINE_MATCH_TOKEN_SECRET', 'dev-insecure-match-token-secret'),
    matchTokenTtlSeconds: envInt('EVENT_PIPELINE_MATCH_TOKEN_TTL_SECONDS', 6 * 60 * 60), // 6h default match length
    rateLimitBatchPerWindow: envInt('EVENT_PIPELINE_RATE_LIMIT_BATCH_PER_WINDOW', 60),
    rateLimitBatchWindowMs: envInt('EVENT_PIPELINE_RATE_LIMIT_BATCH_WINDOW_MS', 60 * 1000),
    rateLimitReadPerWindow: envInt('EVENT_PIPELINE_RATE_LIMIT_READ_PER_WINDOW', 120),
    rateLimitReadWindowMs: envInt('EVENT_PIPELINE_RATE_LIMIT_READ_WINDOW_MS', 60 * 1000),
    defaultPageSize: envInt('EVENT_PIPELINE_DEFAULT_PAGE_SIZE', 100),
    maxPageSize: envInt('EVENT_PIPELINE_MAX_PAGE_SIZE', 1000),
    version: envString('EVENT_PIPELINE_VERSION', '0.1.0'),
  };

  return { ...base, ...overrides };
}
