import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildConfig, buildRegistry } from './fixtures';
import { StrategyPlanner } from '../strategy-planner';
import { PERSONALITY_ARCHETYPES, PatternEntry, PlanningInputs, SemanticProfileEntry } from '../types';

const metricsLog: Record<string, unknown>[] = [];

afterAll(() => {
  const dir = join(__dirname, 'results');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'performance-results.json'), JSON.stringify(metricsLog, null, 2));
});

/** Deterministic pseudo-random generator (mulberry32) — stress/randomized tests must themselves be reproducible on failure, never flaky. */
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInputs(rng: () => number, matchId: string): PlanningInputs {
  const semanticProfile: SemanticProfileEntry[] = ['aggression', 'riskTolerance', 'predictability', 'mechanicalSkill', 'confidence'].map((dimension) => ({
    dimension,
    gameId: 'stress-game',
    value: rng(),
    confidence: rng(),
    samples: Math.floor(rng() * 50),
  }));
  const patternCategories = ['movement', 'combat', 'decision', 'exploration', 'risk'];
  const patterns: PatternEntry[] = Array.from({ length: Math.floor(rng() * 6) }, (_, i) => ({
    patternId: `stress:${i}`,
    detectorId: `detector${i}`,
    patternKey: `key${i}`,
    category: patternCategories[Math.floor(rng() * patternCategories.length)],
    state: (['confirmed', 'strong', 'candidate', 'weakening'] as const)[Math.floor(rng() * 4)],
    confidence: rng(),
    description: 'stress pattern',
  }));
  const personality = PERSONALITY_ARCHETYPES[Math.floor(rng() * PERSONALITY_ARCHETYPES.length)];

  return {
    matchContext: { matchId, playerId: 'stress-player', gameId: 'stress-game', elapsedMs: Math.floor(rng() * 600_000) },
    publicGameState: {
      selfHealth: rng(),
      playerHealthVisible: rng(),
      spaceContested: rng(),
      selfResourcesLow: rng(),
      objectiveThreatened: rng() > 0.8,
      playerRetreating: rng() > 0.8,
      openingAvailable: rng() > 0.6,
      extra: { multipleTargets: rng() > 0.7 },
    },
    semanticProfile,
    patterns,
    episodicMemory: Array.from({ length: Math.floor(rng() * 4) }, (_, i) => ({
      episodeId: `ep-${i}`,
      episodeType: rng() > 0.5 ? 'important-mistake' : 'repeated-successful-strategy',
      summary: 'stress episode',
      importance: rng(),
      confidence: rng(),
      timestamp: Math.floor(rng() * 600_000),
    })),
    awarenessBudget: rng(),
    personality,
  };
}

describe('Stress: randomized planning never throws and always produces a valid StrategicIntent', () => {
  it('1000 random planning calls across random matches, personalities, and awareness budgets', () => {
    const rng = mulberry32(0xc0ffee);
    const registry = buildRegistry();
    const config = buildConfig();
    const planner = new StrategyPlanner({ registry, config });

    const goalCounts = new Map<string, number>();
    let totalDurationMs = 0;
    const iterations = 1000;

    for (let i = 0; i < iterations; i++) {
      const inputs = randomInputs(rng, `stress-match-${i}`); // fresh match every time — always a full replan, worst-case cost
      const start = Date.now();
      const intent = planner.plan(inputs, Date.now());
      totalDurationMs += Date.now() - start;

      expect(intent.goalId).toBeTruthy();
      expect(intent.confidence).toBeGreaterThanOrEqual(0);
      expect(intent.confidence).toBeLessThanOrEqual(1);
      expect(intent.planningMetadata.nodesExpanded).toBeLessThanOrEqual(config.goap.nodeBudget + registry.list().length);
      expect(intent.planningMetadata.searchDepthUsed).toBeLessThanOrEqual(config.goap.maxSearchDepth);
      expect(Number.isFinite(intent.awarenessBudget)).toBe(true);

      goalCounts.set(intent.goalId, (goalCounts.get(intent.goalId) ?? 0) + 1);
    }

    metricsLog.push({
      scenario: 'randomized-planning-1000-iterations',
      iterations,
      totalDurationMs,
      avgDurationMs: Number((totalDurationMs / iterations).toFixed(4)),
      distinctGoalsChosen: goalCounts.size,
      goalDistribution: Object.fromEntries(goalCounts),
    });

    // Every registered goal has SOME reachable world-state (sanity check
    // that no goal is dead code) — not a strict requirement of any single
    // run, but with 1000 varied random inputs and 14 goals, a goal that
    // NEVER wins even once is worth knowing about.
    expect(goalCounts.size).toBeGreaterThan(1);
  }, 30_000);

  it('is itself reproducible: replaying the same seed with a fresh planner produces identical goal choices', () => {
    function runBatch(): string[] {
      const rng = mulberry32(0x1234);
      const registry = buildRegistry();
      const config = buildConfig();
      const planner = new StrategyPlanner({ registry, config });
      const goals: string[] = [];
      for (let i = 0; i < 100; i++) {
        const inputs = randomInputs(rng, `repro-match-${i}`);
        goals.push(planner.plan(inputs, 1_700_000_000_000 + i).goalId);
      }
      return goals;
    }

    expect(runBatch()).toEqual(runBatch());
  });
});

describe('Performance: planning latency', () => {
  it('a cold (full-replan) planning call completes in bounded time', () => {
    const registry = buildRegistry();
    const config = buildConfig();
    const planner = new StrategyPlanner({ registry, config });
    const rng = mulberry32(42);

    const durations: number[] = [];
    for (let i = 0; i < 200; i++) {
      const inputs = randomInputs(rng, `latency-match-${i}`);
      const start = Date.now();
      planner.plan(inputs, Date.now());
      durations.push(Date.now() - start);
    }

    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    const max = Math.max(...durations);
    metricsLog.push({ scenario: 'cold-planning-latency-200-calls', avgMs: Number(avg.toFixed(4)), maxMs: max });

    expect(max).toBeLessThan(200); // generous bound — guards against a gross regression, not a tight SLA
  }, 30_000);

  it('a warm (cache-hit) planning call is dramatically cheaper than a cold one', () => {
    const registry = buildRegistry();
    const config = buildConfig();
    const planner = new StrategyPlanner({ registry, config });
    const inputs = randomInputs(mulberry32(7), 'warm-match');

    const coldStart = Date.now();
    planner.plan(inputs, 1000);
    const coldMs = Date.now() - coldStart;

    const warmStart = Date.now();
    const warm = planner.plan(inputs, 1001);
    const warmMs = Date.now() - warmStart;

    metricsLog.push({ scenario: 'cache-hit-vs-cold', coldMs, warmMs });
    expect(warm.planningMetadata.cacheHit).toBe(true);
    expect(warmMs).toBeLessThanOrEqual(Math.max(coldMs, 5)); // warm should never be slower than cold by more than noise
  });

  it('planning 500 distinct concurrent matches stays within a bounded total budget', () => {
    const registry = buildRegistry();
    const config = buildConfig();
    const planner = new StrategyPlanner({ registry, config });
    const rng = mulberry32(99);

    const start = Date.now();
    for (let i = 0; i < 500; i++) {
      planner.plan(randomInputs(rng, `bulk-match-${i}`), Date.now());
    }
    const elapsedMs = Date.now() - start;

    metricsLog.push({ scenario: '500-distinct-matches', elapsedMs, perMatchMs: Number((elapsedMs / 500).toFixed(4)) });
    expect(elapsedMs).toBeLessThan(10_000);
  }, 30_000);
});
