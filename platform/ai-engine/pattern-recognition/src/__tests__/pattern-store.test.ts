import { describe, it, expect, beforeEach } from 'vitest';
import { PatternStore } from '../pattern-store';
import { loadPatternRecognitionConfig } from '../config';
import { PatternTuning } from '../types';
import { makePatternStore } from './fixtures';

function tuning(overrides: Partial<PatternTuning> = {}): PatternTuning {
  return {
    k: 10,
    concentrationBaseline: 0.5,
    contradictionDecayRate: 0.3,
    decayRatePerDay: 0.05,
    lifecycle: { confirmedConfidence: 0.5, strongConfidence: 0.8, retiredConfidence: 0.15 },
    ...overrides,
  };
}

describe('PatternStore — upsert & versioning', () => {
  let store: PatternStore;

  beforeEach(async () => {
    store = makePatternStore();
    await store.ensureIndexes();
  });

  it('creates a new pattern record on first observation, starting at version 1', async () => {
    const { record, previousState } = await store.upsert({
      playerId: 'p1',
      gameId: 'g1',
      detectorId: 'd1',
      patternKey: 'k1',
      category: 'combat',
      description: 'test pattern',
      opportunities: 1,
      matches: 1,
      matchId: 'm1',
      now: 1000,
      tuning: tuning(),
    });
    expect(previousState).toBeNull();
    expect(record.version).toBe(1);
    expect(record.firstDetectedAt).toBe(1000);
    expect(record.patternId).toBe('d1:k1');
  });

  it('folds subsequent matches into the SAME record, incrementing version and accumulating counts', async () => {
    const input = { playerId: 'p1', gameId: 'g1', detectorId: 'd1', patternKey: 'k1', category: 'combat' as const, description: 'x', tuning: tuning() };
    await store.upsert({ ...input, opportunities: 1, matches: 1, matchId: 'm1', now: 1000 });
    const { record } = await store.upsert({ ...input, opportunities: 1, matches: 1, matchId: 'm2', now: 2000 });
    expect(record.version).toBe(2);
    expect(record.observationCount).toBe(2);
    expect(record.lastSeenMatchId).toBe('m2');
    expect(record.firstDetectedAt).toBe(1000); // preserved from the first version
  });

  it('never deletes historical evidence: getHistory returns every prior version, most-recent first', async () => {
    const input = { playerId: 'p1', gameId: 'g1', detectorId: 'd1', patternKey: 'k1', category: 'combat' as const, description: 'x', tuning: tuning() };
    await store.upsert({ ...input, opportunities: 1, matches: 1, matchId: 'm1', now: 1000 });
    await store.upsert({ ...input, opportunities: 1, matches: 1, matchId: 'm2', now: 2000 });
    await store.upsert({ ...input, opportunities: 1, matches: 0, matchId: 'm3', now: 3000 });
    const history = await store.getHistory('p1', 'g1', 'd1:k1');
    expect(history).toHaveLength(3);
    expect(history[0].version).toBe(3);
    expect(history[2].version).toBe(1);
  });

  it('records a transition entry only when the lifecycle state actually changes', async () => {
    const input = { playerId: 'p1', gameId: 'g1', detectorId: 'd1', patternKey: 'k1', category: 'combat' as const, description: 'x', tuning: tuning() };
    await store.upsert({ ...input, opportunities: 30, matches: 30, matchId: 'm1', now: 1000 }); // jumps straight to confirmed/strong
    const history = await store.getHistory('p1', 'g1', 'd1:k1');
    expect(history[0].transition).not.toBeNull();
    expect(history[0].transition!.from).toBeNull();
  });
});

describe('PatternStore — search API', () => {
  let store: PatternStore;

  beforeEach(async () => {
    store = makePatternStore();
    await store.ensureIndexes();
    await store.upsert({ playerId: 'p1', gameId: 'g1', detectorId: 'd1', patternKey: 'k1', category: 'combat', description: 'x', opportunities: 30, matches: 30, matchId: 'm1', now: 1000, tuning: tuning() });
    await store.upsert({ playerId: 'p1', gameId: 'g1', detectorId: 'd2', patternKey: 'k2', category: 'movement', description: 'y', opportunities: 2, matches: 1, matchId: 'm2', now: 5000, tuning: tuning() });
    await store.upsert({ playerId: 'p2', gameId: 'g1', detectorId: 'd1', patternKey: 'k1', category: 'combat', description: 'z', opportunities: 2, matches: 1, matchId: 'm3', now: 2000, tuning: tuning() });
  });

  it('filters by player', async () => {
    const { patterns } = await store.search({ playerId: 'p1' });
    expect(patterns).toHaveLength(2);
  });

  it('filters by category', async () => {
    const { patterns } = await store.search({ playerId: 'p1', category: 'movement' });
    expect(patterns).toHaveLength(1);
    expect(patterns[0].patternKey).toBe('k2');
  });

  it('filters by minConfidence', async () => {
    const { patterns } = await store.search({ playerId: 'p1', minConfidence: 0.5 });
    expect(patterns.every((p) => p.confidence >= 0.5)).toBe(true);
  });

  it('filters by state', async () => {
    const { patterns } = await store.search({ playerId: 'p1', state: 'candidate' });
    expect(patterns.every((p) => p.state === 'candidate')).toBe(true);
  });

  it('filters by recent activity (observedSince)', async () => {
    const { patterns } = await store.search({ playerId: 'p1', observedSince: 4000 });
    expect(patterns).toHaveLength(1);
    expect(patterns[0].patternKey).toBe('k2');
  });

  it('filters by time range (firstDetectedAt)', async () => {
    const { patterns } = await store.search({ fromTs: 0, toTs: 3000 });
    expect(patterns.map((p) => p.playerId).sort()).toEqual(['p1', 'p2']);
  });

  it('sorts by confidence when requested', async () => {
    const { patterns } = await store.search({ playerId: 'p1', sortBy: 'confidence' });
    expect(patterns[0].confidence).toBeGreaterThanOrEqual(patterns[1].confidence);
  });
});

describe('PatternStore — dormancy decay', () => {
  it('decays confidence for patterns not observed recently and re-evaluates lifecycle state', async () => {
    const store = makePatternStore();
    await store.ensureIndexes();
    await store.upsert({ playerId: 'p1', gameId: 'g1', detectorId: 'd1', patternKey: 'k1', category: 'combat', description: 'x', opportunities: 30, matches: 30, matchId: 'm1', now: 0, tuning: tuning() });

    const before = await store.getByPatternId('p1', 'g1', 'd1:k1');
    const config = loadPatternRecognitionConfig({ detectorTuning: { d1: tuning({ decayRatePerDay: 0.5 }) } });
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
    const decayedCount = await store.decayDormantPatterns(config, oneYearMs);

    const after = await store.getByPatternId('p1', 'g1', 'd1:k1');
    expect(decayedCount).toBe(1);
    expect(after!.confidence).toBeLessThan(before!.confidence);
  });

  it('never decays an already-retired pattern', async () => {
    const store = makePatternStore();
    await store.ensureIndexes();
    await store.upsert({ playerId: 'p1', gameId: 'g1', detectorId: 'd1', patternKey: 'k1', category: 'combat', description: 'x', opportunities: 1, matches: 0, matchId: 'm1', now: 0, tuning: tuning() });
    const record = await store.getByPatternId('p1', 'g1', 'd1:k1');
    expect(record!.state).toBe('retired'); // a single contradicting observation with no prior evidence never clears confirmedConfidence

    const config = loadPatternRecognitionConfig();
    const decayedCount = await store.decayDormantPatterns(config, 365 * 24 * 60 * 60 * 1000);
    expect(decayedCount).toBe(0);
  });
});
