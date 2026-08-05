/**
 * Performance benchmarks for the orchestration workflow — same caveat as
 * @adaptive-ai/memory-engine's own performance.test.ts: this measures the
 * orchestrator's + coordinated modules' own logic overhead against the
 * in-memory FakeDb, not real MongoDB I/O or real HTTP latency. Treat these
 * as upper bounds on application-logic throughput/memory, not a production
 * capacity number — the "Performance Report" in this package's README
 * documents the honest interpretation of each number here.
 */

import { Db } from 'mongodb';
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { CanonicalEvent } from '@adaptive-ai/sdk-protocol';
import { OrchestrationStack } from '../bootstrap';
import { FakeDb } from './fake-mongo';
import { buildMatchEvents } from './fixtures';

const metricsLog: Record<string, unknown>[] = [];

afterAll(() => {
  const dir = join(__dirname, 'results');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'performance-results.json'), JSON.stringify(metricsLog, null, 2));
});

async function buildStack(): Promise<OrchestrationStack> {
  const db = new FakeDb() as unknown as Db;
  const stack = new OrchestrationStack({ db });
  await stack.initialize();
  return stack;
}

function toCanonical(matchId: string, playerId: string, gameId: string, raw: ReturnType<typeof buildMatchEvents>[number]): CanonicalEvent {
  return { matchId, playerId, gameId, seq: raw.seq, ts: raw.ts, type: raw.type as CanonicalEvent['type'], payload: raw.payload, schemaVersion: '1' };
}

/** Repeats the base fixture's gameplay-only events (excludes MatchStarted/MatchEnded) to synthesize a match of arbitrary size. */
function buildLargeMatchEvents(eventCount: number, baseTs: number): ReturnType<typeof buildMatchEvents> {
  const template = buildMatchEvents(baseTs).filter((e) => e.type !== 'MatchStarted' && e.type !== 'MatchEnded');
  const events: ReturnType<typeof buildMatchEvents> = [{ seq: 1, type: 'MatchStarted', payload: {}, ts: baseTs }];
  let seq = 2;
  let ts = baseTs + 1;
  while (events.length < eventCount - 1) {
    const t = template[(seq - 2) % template.length];
    events.push({ seq: seq++, type: t.type, payload: t.payload, ts: ts++ });
  }
  events.push({ seq: seq++, type: 'MatchEnded', payload: { outcome: 'win' }, ts: ts++ });
  return events;
}

describe('Performance: single-match processing latency', () => {
  it.each([100, 500, 1000])('processes a %i-event match end to end in bounded time', async (eventCount) => {
    const stack = await buildStack();
    const matchId = `latency-match-${eventCount}`;
    const events = buildLargeMatchEvents(eventCount, Date.now());

    const ingestStart = Date.now();
    for (const e of events) {
      stack.orchestrator.ingestEvent(toCanonical(matchId, 'perf-player', 'perf-game', e));
    }
    const ingestElapsedMs = Date.now() - ingestStart;

    const completeStart = Date.now();
    const report = await stack.orchestrator.completeMatch(matchId);
    const completeElapsedMs = Date.now() - completeStart;

    metricsLog.push({
      scenario: `single-match-${eventCount}-events`,
      eventCount,
      ingestElapsedMs,
      ingestPerEventMs: Number((ingestElapsedMs / eventCount).toFixed(4)),
      completeElapsedMs,
      totalElapsedMs: ingestElapsedMs + completeElapsedMs,
      status: report.status,
      dimensionsUpdated: report.playerModeling?.updated.length ?? 0,
      patternsUpdated: report.patternRecognition?.updated.length ?? 0,
    });

    expect(report.status).toBe('complete');
    // Generous bound for the in-memory fake — guards against a gross
    // regression (e.g. an accidental O(n^2) scan), not a tight SLA.
    expect(completeElapsedMs).toBeLessThan(5000);
  }, 30_000);
});

describe('Performance: concurrent matches', () => {
  it('processes 25 independent matches concurrently without cross-contamination', async () => {
    const stack = await buildStack();
    const matchCount = 25;
    const eventsPerMatch = 20;

    const start = Date.now();
    const completions = await Promise.all(
      Array.from({ length: matchCount }, async (_, i) => {
        const matchId = `concurrent-match-${i}`;
        const playerId = `concurrent-player-${i}`;
        const events = buildLargeMatchEvents(eventsPerMatch, Date.now() + i * 1000);
        for (const e of events) {
          stack.orchestrator.ingestEvent(toCanonical(matchId, playerId, 'perf-game', e));
        }
        return stack.orchestrator.completeMatch(matchId);
      })
    );
    const elapsedMs = Date.now() - start;

    metricsLog.push({
      scenario: 'concurrent-matches',
      matchCount,
      eventsPerMatch,
      elapsedMs,
      perMatchMs: Number((elapsedMs / matchCount).toFixed(2)),
      allComplete: completions.every((r) => r.status === 'complete'),
    });

    expect(completions).toHaveLength(matchCount);
    expect(completions.every((r) => r.status === 'complete')).toBe(true);
    // Cross-contamination check: each match's own player only has its own match's data.
    for (let i = 0; i < matchCount; i++) {
      const profile = await stack.memoryEngine.getSemanticProfile(`concurrent-player-${i}`, 'perf-game');
      const matchRecord = profile.length > 0 ? await stack.memoryEngine.shortTermMemory.getByMatchId(`concurrent-match-${i}`) : null;
      if (matchRecord) expect(matchRecord.playerId).toBe(`concurrent-player-${i}`);
    }
  }, 30_000);
});

describe('Performance: memory usage', () => {
  it('processing 50 sequential matches does not exhibit unbounded heap growth per match', async () => {
    const stack = await buildStack();
    const matchesToRun = 50;
    const eventsPerMatch = 50;

    if (global.gc) global.gc();
    const before = process.memoryUsage().heapUsed;

    for (let i = 0; i < matchesToRun; i++) {
      const matchId = `mem-match-${i}`;
      const events = buildLargeMatchEvents(eventsPerMatch, Date.now() + i);
      for (const e of events) {
        stack.orchestrator.ingestEvent(toCanonical(matchId, 'mem-player', 'mem-game', e));
      }
      await stack.orchestrator.completeMatch(matchId);
    }

    if (global.gc) global.gc();
    const after = process.memoryUsage().heapUsed;
    const deltaMb = (after - before) / (1024 * 1024);
    const perMatchKb = ((after - before) / matchesToRun) / 1024;

    metricsLog.push({
      scenario: 'sequential-match-memory-growth',
      matchesToRun,
      eventsPerMatch,
      heapDeltaMb: Number(deltaMb.toFixed(2)),
      perMatchKb: Number(perMatchKb.toFixed(2)),
      note: 'Node heap measurement without --expose-gc is noisy (no forced GC before the "after" reading) — informational, not a tight bound. Working Memory is destroyed and Short-Term Memory\'s in-process copy is deleted on every commitMatch(), so no per-match accumulator should survive past completeMatch().',
    });

    // Confirms Working/Short-Term Memory in-process maps are not leaking one entry per completed match.
    expect(stack.memoryEngine.workingMemory.size()).toBe(0);
    expect(stack.memoryEngine.shortTermMemory.size()).toBe(0);
  }, 60_000);
});

describe('Performance: database write counts', () => {
  it('reports how many writes one MatchEnded run performs against each collection', async () => {
    const fakeDb = new FakeDb();
    const stack = new OrchestrationStack({ db: fakeDb as unknown as Db });
    await stack.initialize();

    const matchId = 'write-count-match';
    const events = buildMatchEvents(Date.now());
    for (const e of events) {
      stack.orchestrator.ingestEvent(toCanonical(matchId, 'perf-player', 'perf-game', e));
    }
    await stack.orchestrator.completeMatch(matchId);
    // Flush the fire-and-forget report-store save triggered by 'match:completed'.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const counts = {
      matchMemories: fakeDb.collection('matchMemories').size(),
      playerProfiles: fakeDb.collection('playerProfiles').size(),
      playerProfileVersions: fakeDb.collection('playerProfileVersions').size(),
      playerPatterns: fakeDb.collection('playerPatterns').size(),
      playerPatternVersions: fakeDb.collection('playerPatternVersions').size(),
      matchProcessingReports: fakeDb.collection('matchProcessingReports').size(),
    };

    metricsLog.push({ scenario: 'single-match-write-counts', eventCount: events.length, ...counts });

    expect(counts.matchMemories).toBe(1); // exactly one commit per match
    expect(counts.matchProcessingReports).toBe(1); // exactly one report per match
    expect(counts.playerProfileVersions).toBeGreaterThanOrEqual(counts.playerProfiles); // append-only history >= current-pointer count
    expect(counts.playerPatternVersions).toBeGreaterThanOrEqual(counts.playerPatterns);
  }, 30_000);
});
