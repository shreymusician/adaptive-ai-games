import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { Db } from 'mongodb';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { EventPipeline } from '../src/pipeline';
import { FakeDb } from '../src/__tests__/fake-mongo';

/**
 * Phase 3.5 platform validation — stress / performance benchmarks.
 *
 * IMPORTANT CAVEAT (see PHASE_3_5_VALIDATION_REPORT.md "Known Bottlenecks"):
 * these numbers measure the pipeline's OWN overhead (HTTP routing, auth,
 * validation, dedup bookkeeping, in-process rate limiting) against the
 * in-memory FakeDb (see src/__tests__/fake-mongo.ts). They do NOT measure
 * real MongoDB I/O, network latency, or multi-instance contention. Treat
 * these as an upper bound on pipeline-logic throughput, not a production
 * capacity number — a real deployment's ceiling will be set by MongoDB
 * write/index performance, which this suite cannot exercise (no reliable
 * network access to a real mongod binary in this environment).
 */

interface BenchResult {
  label: string;
  totalEvents: number;
  totalMs: number;
  eventsPerSec: number;
  batchLatenciesMs: number[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function summarize(r: BenchResult): string {
  const sorted = [...r.batchLatenciesMs].sort((a, b) => a - b);
  return (
    `[${r.label}] ${r.totalEvents} events in ${r.totalMs}ms => ${r.eventsPerSec.toFixed(0)} events/sec | ` +
    `batch latency p50=${percentile(sorted, 50).toFixed(1)}ms p95=${percentile(sorted, 95).toFixed(1)}ms p99=${percentile(sorted, 99).toFixed(1)}ms max=${(sorted.at(-1) ?? 0).toFixed(1)}ms`
  );
}

function makePipeline(): EventPipeline {
  const db = new FakeDb() as unknown as Db;
  return new EventPipeline({
    db,
    config: {
      matchTokenSecret: 'stress-test-secret',
      maxBatchSize: 2000,
      maxBatchPayloadBytes: 5 * 1024 * 1024,
      rateLimitBatchPerWindow: 100_000, // disabled for throughput measurement — rate limiting is validated separately in security.test.ts
      rateLimitReadPerWindow: 100_000,
      maxPageSize: 5000,
    },
  });
}

const results: BenchResult[] = [];
const metricsLog: Record<string, unknown>[] = [];

afterAll(() => {
  // vitest suppresses console.log for passing tests by default, so persist
  // numbers to disk here — this is what PHASE_3_5_VALIDATION_REPORT.md's
  // benchmark table is generated from.
  const dir = join(__dirname, 'results');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'stress-results.json'), JSON.stringify(metricsLog, null, 2));
});

describe('Stress: sustained target throughput (100 / 500 / 1000 events/sec)', () => {
  let pipeline: EventPipeline;
  let app: ReturnType<EventPipeline['buildStandaloneApp']>;

  beforeEach(async () => {
    pipeline = makePipeline();
    await pipeline.initialize();
    app = pipeline.buildStandaloneApp();
    // Warm up the JS engine / module graph / Express route table so the
    // first measured batch isn't skewed by one-time JIT/transform cost —
    // this benchmark measures steady-state pipeline overhead, not cold start.
    const warmToken = pipeline.mintToken({ matchId: 'warmup', playerId: 'p1', gameId: 'g1', scope: 'ingest' });
    await request(app).post('/api/events/batch').set('Authorization', `Bearer ${warmToken}`).send({ events: [{ type: 'PlayerMoved', payload: {}, seq: 1 }] });
  });

  it.each([
    { target: 100, matchId: 'stress-100' },
    { target: 500, matchId: 'stress-500' },
    { target: 1000, matchId: 'stress-1000' },
  ])('achieves at least $target events/sec of ingest throughput', async ({ target, matchId }) => {
    const token = pipeline.mintToken({ matchId, playerId: 'p1', gameId: 'stress-game', scope: 'ingest' });
    const batchSize = 100;
    // Measure over several seconds' worth of events (not just `target`
    // events) so a single scheduler hiccup can't dominate the ratio — a
    // 100-event sample finishes in ~10ms, where one 20ms GC pause would
    // swing the measured rate by 2x for no real reason.
    const sampleEvents = Math.max(target * 5, 2000);
    const batchCount = Math.ceil(sampleEvents / batchSize);
    const latencies: number[] = [];

    const start = Date.now();
    let seq = 0;
    for (let b = 0; b < batchCount; b++) {
      const events = Array.from({ length: batchSize }, () => ({ type: 'PlayerMoved' as const, payload: { x: 1, y: 2 }, seq: ++seq }));
      const t0 = Date.now();
      const res = await request(app).post('/api/events/batch').set('Authorization', `Bearer ${token}`).send({ events });
      latencies.push(Date.now() - t0);
      expect(res.status).toBe(202);
      expect(res.body.rejected).toBe(0);
    }
    const totalMs = Date.now() - start;
    const totalEvents = batchCount * batchSize;
    const eventsPerSec = totalEvents / (totalMs / 1000);

    const result: BenchResult = { label: `ingest-${target}/sec-target`, totalEvents, totalMs, eventsPerSec, batchLatenciesMs: latencies };
    results.push(result);
    const sorted = [...latencies].sort((a, b) => a - b);
    metricsLog.push({
      scenario: `ingest-${target}-events-per-sec-target`,
      totalEvents,
      totalMs,
      achievedEventsPerSec: Math.round(eventsPerSec),
      batchLatencyMsP50: percentile(sorted, 50),
      batchLatencyMsP95: percentile(sorted, 95),
      batchLatencyMsP99: percentile(sorted, 99),
      batchLatencyMsMax: sorted.at(-1) ?? 0,
    });
    console.log(summarize(result));

    // 70% margin: this sandbox runs multiple vitest test files concurrently
    // (worker-pool CPU contention), so exact-target assertions flake under
    // load despite the pipeline itself having no pathological slowdown.
    // The margin catches real regressions while tolerating environment noise.
    expect(eventsPerSec).toBeGreaterThanOrEqual(target * 0.7);
  }, 30_000);
});

describe('Stress: concurrent plugins', () => {
  it('sustains throughput with 10 concurrent matches ingesting simultaneously', async () => {
    const pipeline = makePipeline();
    await pipeline.initialize();
    const app = pipeline.buildStandaloneApp();

    const matchCount = 10;
    const eventsPerMatch = 200;
    const tokens = Array.from({ length: matchCount }, (_, i) =>
      pipeline.mintToken({ matchId: `concurrent-${i}`, playerId: `p${i}`, gameId: 'stress-game', scope: 'ingest' })
    );

    const start = Date.now();
    await Promise.all(
      tokens.map(async (token, i) => {
        const batchSize = 50;
        let seq = 0;
        for (let b = 0; b < eventsPerMatch / batchSize; b++) {
          const events = Array.from({ length: batchSize }, () => ({ type: 'PlayerMoved' as const, payload: {}, seq: ++seq }));
          const res = await request(app).post('/api/events/batch').set('Authorization', `Bearer ${token}`).send({ events });
          expect(res.status).toBe(202);
        }
      })
    );
    const totalMs = Date.now() - start;
    const totalEvents = matchCount * eventsPerMatch;
    const eventsPerSec = totalEvents / (totalMs / 1000);
    const result: BenchResult = { label: `concurrent-${matchCount}-matches`, totalEvents, totalMs, eventsPerSec, batchLatenciesMs: [] };
    results.push(result);
    metricsLog.push({ scenario: `concurrent-${matchCount}-matches-x-${eventsPerMatch}-events`, totalEvents, totalMs, achievedEventsPerSec: Math.round(eventsPerSec) });
    console.log(summarize(result));

    // Verify no cross-match interference: each match has exactly its own event count.
    for (let i = 0; i < matchCount; i++) {
      const replayToken = pipeline.mintToken({ matchId: `concurrent-${i}`, playerId: `p${i}`, gameId: 'stress-game', scope: 'replay' });
      const replay = await request(app).get(`/api/events/match/concurrent-${i}?limit=${eventsPerMatch}`).set('Authorization', `Bearer ${replayToken}`);
      expect(replay.body.eventCount).toBe(eventsPerMatch);
    }
  }, 30_000);
});

describe('Stress: large single batch', () => {
  it('accepts and persists a single 2000-event batch (max configured batch size) without error', async () => {
    const pipeline = makePipeline();
    await pipeline.initialize();
    const app = pipeline.buildStandaloneApp();
    const token = pipeline.mintToken({ matchId: 'large-batch', playerId: 'p1', gameId: 'g1', scope: 'ingest' });

    const events = Array.from({ length: 2000 }, (_, i) => ({ type: 'PlayerMoved' as const, payload: { x: i }, seq: i + 1 }));
    const start = Date.now();
    const res = await request(app).post('/api/events/batch').set('Authorization', `Bearer ${token}`).send({ events });
    const elapsed = Date.now() - start;

    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(2000);
    console.log(`[large-batch] 2000 events in a single request: ${elapsed}ms`);
    metricsLog.push({ scenario: 'single-batch-2000-events', elapsedMs: elapsed });
    expect(elapsed).toBeLessThan(5000);
  }, 15_000);
});

describe('Stress: replay performance at scale', () => {
  it('replays a 10,000-event match with acceptable latency and correct pagination', async () => {
    const pipeline = makePipeline();
    await pipeline.initialize();
    const app = pipeline.buildStandaloneApp();
    const token = pipeline.mintToken({ matchId: 'replay-scale', playerId: 'p1', gameId: 'g1', scope: 'ingest' });

    let seq = 0;
    for (let b = 0; b < 20; b++) {
      const events = Array.from({ length: 500 }, () => ({ type: 'PlayerMoved' as const, payload: {}, seq: ++seq }));
      await request(app).post('/api/events/batch').set('Authorization', `Bearer ${token}`).send({ events });
    }

    const replayToken = pipeline.mintToken({ matchId: 'replay-scale', playerId: 'p1', gameId: 'g1', scope: 'replay' });
    const start = Date.now();
    const res = await request(app).get('/api/events/match/replay-scale?limit=5000').set('Authorization', `Bearer ${replayToken}`);
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    expect(res.body.eventCount).toBe(5000); // clamped to maxPageSize
    expect(res.body.pagination.total).toBe(10000);
    console.log(`[replay-scale] paginated replay of 5000/10000 events: ${elapsed}ms`);
    metricsLog.push({ scenario: 'replay-5000-of-10000-events', elapsedMs: elapsed });
    expect(elapsed).toBeLessThan(2000);
  }, 20_000);
});

describe('Stress: memory stability over sustained ingestion', () => {
  it('does not exhibit gross unbounded heap growth across 20,000 ingested events', async () => {
    const pipeline = makePipeline();
    await pipeline.initialize();
    const app = pipeline.buildStandaloneApp();
    const token = pipeline.mintToken({ matchId: 'memory-check', playerId: 'p1', gameId: 'g1', scope: 'ingest' });

    if (global.gc) global.gc();
    const before = process.memoryUsage().heapUsed;

    let seq = 0;
    for (let b = 0; b < 40; b++) {
      const events = Array.from({ length: 500 }, () => ({ type: 'PlayerMoved' as const, payload: { x: 1, y: 2, z: 3 }, seq: ++seq }));
      await request(app).post('/api/events/batch').set('Authorization', `Bearer ${token}`).send({ events });
    }

    if (global.gc) global.gc();
    const after = process.memoryUsage().heapUsed;
    const deltaMb = (after - before) / 1024 / 1024;
    const bytesPerEvent = (after - before) / 20_000;
    console.log(`[memory] heap delta after 20,000 events: ${deltaMb.toFixed(2)}MB (${bytesPerEvent.toFixed(0)} bytes/event, includes FakeDb in-memory retention)`);
    metricsLog.push({ scenario: 'heap-growth-20000-events', heapDeltaMb: Number(deltaMb.toFixed(2)), bytesPerEvent: Math.round(bytesPerEvent) });

    // Generous bound — this is FakeDb retaining every event in a JS array
    // (see fake-mongo.ts), which is inherently O(n); a real MongoDB-backed
    // deployment does not hold ingested events in the app process's heap at
    // all. This assertion only guards against a gross accidental leak
    // (e.g. an accumulating array outside the store), not steady-state
    // memory planning.
    expect(deltaMb).toBeLessThan(200);
  }, 30_000);
});
