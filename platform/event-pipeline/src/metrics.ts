/**
 * Self-contained metrics registry — no prom-client dependency, but the text
 * exposition format matches Prometheus's so a real Prometheus (or any
 * OpenMetrics-compatible scraper) can scrape GET /api/events/metrics
 * directly. Counters and histograms are the only two primitives implemented
 * because they're the only two this pipeline actually needs.
 */

type LabelSet = Record<string, string>;

function labelKey(labels: LabelSet): string {
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}="${labels[k]}"`).join(',');
}

class Counter {
  private readonly values = new Map<string, number>();
  constructor(
    public readonly name: string,
    public readonly help: string
  ) {}

  inc(labels: LabelSet = {}, amount: number = 1): void {
    const key = labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + amount);
  }

  get(labels: LabelSet = {}): number {
    return this.values.get(labelKey(labels)) ?? 0;
  }

  toPrometheus(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
      return lines.join('\n');
    }
    for (const [key, value] of this.values) {
      lines.push(key ? `${this.name}{${key}} ${value}` : `${this.name} ${value}`);
    }
    return lines.join('\n');
  }
}

const DEFAULT_BUCKETS_MS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

interface HistogramState {
  bucketCounts: number[];
  sum: number;
  count: number;
}

class Histogram {
  private readonly states = new Map<string, HistogramState>();
  constructor(
    public readonly name: string,
    public readonly help: string,
    private readonly buckets: number[] = DEFAULT_BUCKETS_MS
  ) {}

  observe(valueMs: number, labels: LabelSet = {}): void {
    const key = labelKey(labels);
    let state = this.states.get(key);
    if (!state) {
      state = { bucketCounts: new Array(this.buckets.length).fill(0), sum: 0, count: 0 };
      this.states.set(key, state);
    }
    for (let i = 0; i < this.buckets.length; i++) {
      if (valueMs <= this.buckets[i]) state.bucketCounts[i] += 1;
    }
    state.sum += valueMs;
    state.count += 1;
  }

  /** Returns approximate percentile using bucket boundaries (good enough for dashboards, not exact). */
  percentile(p: number, labels: LabelSet = {}): number {
    const state = this.states.get(labelKey(labels));
    if (!state || state.count === 0) return 0;
    const target = Math.ceil((p / 100) * state.count);
    let cumulative = 0;
    for (let i = 0; i < this.buckets.length; i++) {
      cumulative += state.bucketCounts[i];
      if (cumulative >= target) return this.buckets[i];
    }
    return this.buckets[this.buckets.length - 1];
  }

  mean(labels: LabelSet = {}): number {
    const state = this.states.get(labelKey(labels));
    if (!state || state.count === 0) return 0;
    return state.sum / state.count;
  }

  count(labels: LabelSet = {}): number {
    return this.states.get(labelKey(labels))?.count ?? 0;
  }

  toPrometheus(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    if (this.states.size === 0) {
      lines.push(`${this.name}_count 0`, `${this.name}_sum 0`);
      return lines.join('\n');
    }
    for (const [key, state] of this.states) {
      let cumulative = 0;
      for (let i = 0; i < this.buckets.length; i++) {
        cumulative += state.bucketCounts[i];
        const labelPart = key ? `${key},le="${this.buckets[i]}"` : `le="${this.buckets[i]}"`;
        lines.push(`${this.name}_bucket{${labelPart}} ${cumulative}`);
      }
      const infPart = key ? `${key},le="+Inf"` : `le="+Inf"`;
      lines.push(`${this.name}_bucket{${infPart}} ${state.count}`);
      lines.push(key ? `${this.name}_sum{${key}} ${state.sum}` : `${this.name}_sum ${state.sum}`);
      lines.push(key ? `${this.name}_count{${key}} ${state.count}` : `${this.name}_count ${state.count}`);
    }
    return lines.join('\n');
  }
}

/**
 * Central metrics registry for the pipeline process. One instance is created
 * per EventPipeline and threaded through the processor, router, and
 * middleware so every stage records against the same counters.
 */
export class MetricsRegistry {
  readonly eventsProcessed = new Counter('event_pipeline_events_processed_total', 'Events processed, labeled by outcome');
  readonly validationFailures = new Counter('event_pipeline_validation_failures_total', 'Batch/event validation failures');
  readonly duplicateEvents = new Counter('event_pipeline_duplicate_events_total', 'Events rejected as duplicates');
  readonly outOfOrderEvents = new Counter('event_pipeline_out_of_order_events_total', 'Events accepted but flagged out-of-order');
  readonly rateLimitRejections = new Counter('event_pipeline_rate_limit_rejections_total', 'Requests rejected by rate limiting');
  readonly authFailures = new Counter('event_pipeline_auth_failures_total', 'Requests rejected by authentication/authorization');
  readonly batchesReceived = new Counter('event_pipeline_batches_received_total', 'Batches received, labeled by outcome');

  readonly batchLatencyMs = new Histogram('event_pipeline_batch_latency_ms', 'End-to-end batch processing latency');
  readonly storageLatencyMs = new Histogram('event_pipeline_storage_latency_ms', 'MongoDB write latency for batch persistence');
  readonly replayLatencyMs = new Histogram('event_pipeline_replay_latency_ms', 'Replay query latency');
  readonly httpRequestMs = new Histogram('event_pipeline_http_request_duration_ms', 'HTTP request duration');

  private readonly startedAt = Date.now();

  uptimeSeconds(): number {
    return (Date.now() - this.startedAt) / 1000;
  }

  /** Aggregated snapshot used by the /health endpoint and tests. */
  snapshot() {
    return {
      timestamp: new Date(),
      eventsProcessed: this.eventsProcessed.get({ outcome: 'accepted' }),
      eventsValid: this.eventsProcessed.get({ outcome: 'accepted' }),
      eventsDuplicate: this.duplicateEvents.get(),
      eventsOutOfOrder: this.outOfOrderEvents.get(),
      validationErrors: this.validationFailures.get(),
      averageLatencyMs: this.batchLatencyMs.mean(),
      p95LatencyMs: this.batchLatencyMs.percentile(95),
      p99LatencyMs: this.batchLatencyMs.percentile(99),
    };
  }

  toPrometheusText(): string {
    return [
      this.eventsProcessed.toPrometheus(),
      this.validationFailures.toPrometheus(),
      this.duplicateEvents.toPrometheus(),
      this.outOfOrderEvents.toPrometheus(),
      this.rateLimitRejections.toPrometheus(),
      this.authFailures.toPrometheus(),
      this.batchesReceived.toPrometheus(),
      this.batchLatencyMs.toPrometheus(),
      this.storageLatencyMs.toPrometheus(),
      this.replayLatencyMs.toPrometheus(),
      this.httpRequestMs.toPrometheus(),
    ].join('\n\n') + '\n';
  }
}
