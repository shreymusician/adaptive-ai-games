import { describe, it, expect } from 'vitest';
import { MetricsRegistry } from '../metrics';

describe('MetricsRegistry counters', () => {
  it('increments and reads back a labeled counter', () => {
    const m = new MetricsRegistry();
    m.eventsProcessed.inc({ outcome: 'accepted' }, 5);
    m.eventsProcessed.inc({ outcome: 'accepted' }, 2);
    m.eventsProcessed.inc({ outcome: 'rejected' }, 1);
    expect(m.eventsProcessed.get({ outcome: 'accepted' })).toBe(7);
    expect(m.eventsProcessed.get({ outcome: 'rejected' })).toBe(1);
  });

  it('defaults unset labels to zero', () => {
    const m = new MetricsRegistry();
    expect(m.duplicateEvents.get()).toBe(0);
  });
});

describe('MetricsRegistry histograms', () => {
  it('computes mean and percentile from observations', () => {
    const m = new MetricsRegistry();
    for (const v of [1, 5, 10, 25, 50, 100, 250, 500, 1000]) {
      m.batchLatencyMs.observe(v);
    }
    expect(m.batchLatencyMs.mean()).toBeGreaterThan(0);
    expect(m.batchLatencyMs.percentile(50)).toBeGreaterThan(0);
    expect(m.batchLatencyMs.percentile(99)).toBeGreaterThanOrEqual(m.batchLatencyMs.percentile(50));
  });

  it('returns 0 for percentile/mean with no observations', () => {
    const m = new MetricsRegistry();
    expect(m.batchLatencyMs.mean()).toBe(0);
    expect(m.batchLatencyMs.percentile(95)).toBe(0);
  });

  it('tracks observation count', () => {
    const m = new MetricsRegistry();
    m.storageLatencyMs.observe(10);
    m.storageLatencyMs.observe(20);
    expect(m.storageLatencyMs.count()).toBe(2);
  });
});

describe('MetricsRegistry.snapshot', () => {
  it('reflects recorded counters and latencies', () => {
    const m = new MetricsRegistry();
    m.eventsProcessed.inc({ outcome: 'accepted' }, 10);
    m.duplicateEvents.inc({}, 3);
    m.outOfOrderEvents.inc({}, 1);
    m.validationFailures.inc({}, 2);
    m.batchLatencyMs.observe(15);

    const snap = m.snapshot();
    expect(snap.eventsProcessed).toBe(10);
    expect(snap.eventsDuplicate).toBe(3);
    expect(snap.eventsOutOfOrder).toBe(1);
    expect(snap.validationErrors).toBe(2);
    expect(snap.averageLatencyMs).toBe(15);
  });
});

describe('MetricsRegistry.toPrometheusText', () => {
  it('produces valid-looking Prometheus exposition text', () => {
    const m = new MetricsRegistry();
    m.eventsProcessed.inc({ outcome: 'accepted' }, 5);
    m.batchLatencyMs.observe(42);

    const text = m.toPrometheusText();
    expect(text).toContain('# HELP event_pipeline_events_processed_total');
    expect(text).toContain('# TYPE event_pipeline_events_processed_total counter');
    expect(text).toContain('event_pipeline_events_processed_total{outcome="accepted"} 5');
    expect(text).toContain('# TYPE event_pipeline_batch_latency_ms histogram');
    expect(text).toContain('event_pipeline_batch_latency_ms_count');
    expect(text).toContain('event_pipeline_batch_latency_ms_sum');
  });

  it('emits a zero line for counters with no observations', () => {
    const m = new MetricsRegistry();
    const text = m.toPrometheusText();
    expect(text).toContain('event_pipeline_duplicate_events_total 0');
  });
});

describe('MetricsRegistry.uptimeSeconds', () => {
  it('returns a non-negative number', () => {
    const m = new MetricsRegistry();
    expect(m.uptimeSeconds()).toBeGreaterThanOrEqual(0);
  });
});
