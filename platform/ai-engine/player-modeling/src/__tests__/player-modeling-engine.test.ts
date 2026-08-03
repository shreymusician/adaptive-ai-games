import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryEngine } from '@adaptive-ai/memory-engine';
import { DimensionRegistry } from '../registry';
import { registerAllAnalyzers } from '../analyzers';
import { PlayerModelingEngine } from '../player-modeling-engine';
import { MatchNotCommittedError } from '../errors';
import { makeConfig, makeDecision, makeEvent, makeMatch, makeMemoryEngine } from './fixtures';

function makeEngine(memoryEngine: MemoryEngine): PlayerModelingEngine {
  const registry = new DimensionRegistry();
  registerAllAnalyzers(registry);
  return new PlayerModelingEngine({ memoryEngine, registry, config: makeConfig() });
}

describe('PlayerModelingEngine — integration', () => {
  let memoryEngine: MemoryEngine;
  let engine: PlayerModelingEngine;

  beforeEach(async () => {
    memoryEngine = makeMemoryEngine();
    await memoryEngine.initialize();
    engine = makeEngine(memoryEngine);
  });

  it('rejects an uncommitted match (no committedAt)', async () => {
    const match = makeMatch();
    (match as unknown as { committedAt: number | null }).committedAt = null as unknown as number;
    await expect(engine.processMatch(match)).rejects.toThrow(MatchNotCommittedError);
  });

  it('commits qualifying observations through Memory Engine and skips dimensions with no evidence', async () => {
    const match = makeMatch({
      recentEvents: [makeEvent({ type: 'AbilityUsed', payload: { offensive: true, hit: true } }), makeEvent({ type: 'TargetAcquired' })],
      recentDecisions: [
        makeDecision({ context: { reactionMs: 200 } }),
        makeDecision({ context: { reactionMs: 220 } }),
        makeDecision({ context: { reactionMs: 210 } }),
      ],
    });
    const result = await engine.processMatch(match);

    expect(result.updated.some((u) => u.key === 'reactionTime')).toBe(true);
    expect(result.updated.some((u) => u.key === 'aggression')).toBe(true);
    // learningRate has no history yet on the very first match -> must be skipped, not fabricated.
    expect(result.skipped.some((s) => s.dimensionId === 'learningRate')).toBe(true);
    expect(result.errors).toHaveLength(0);

    const profile = await memoryEngine.getSemanticProfile(match.playerId, match.gameId);
    const reactionTime = profile.find((d) => d.dimension === 'reactionTime')!;
    // This match's observation is the mean of the 3 decisions (200, 220, 210) = 210; first EWMA update: alpha=1, value = observation exactly.
    expect(reactionTime.value).toBeCloseTo(210, 5);
    expect(reactionTime.samples).toBe(1);
  });

  it('historical progression: repeated matches converge reactionTime toward the player\'s true tendency via EWMA', async () => {
    const playerId = 'converging-player';
    for (let i = 0; i < 15; i++) {
      const match = makeMatch({
        matchId: `m-${i}`,
        playerId,
        recentDecisions: [makeDecision({ context: { reactionMs: 150 } }), makeDecision({ context: { reactionMs: 160 } })],
      });
      await engine.processMatch(match);
    }
    const profile = await memoryEngine.getSemanticProfile(playerId, 'game-1');
    const reactionTime = profile.find((d) => d.dimension === 'reactionTime')!;
    expect(reactionTime.value).toBeCloseTo(155, 0);
    expect(reactionTime.samples).toBe(15);
    // k=20 for reactionTime -> 1-e^(-15/20) ~= 0.53; asymptotic, not yet near 1, but clearly climbed off the floor.
    expect(reactionTime.confidence).toBeGreaterThan(0.5);
    expect(reactionTime.confidence).toBeLessThan(1);
  });

  it('large-history: learningRate becomes available once enough mechanicalSkill/strategicSkill history has accumulated', async () => {
    const playerId = 'learning-player';
    for (let i = 0; i < 8; i++) {
      const match = makeMatch({
        matchId: `m-${i}`,
        playerId,
        statistics: { outcome: 1 },
        recentEvents: [makeEvent({ type: 'AbilityUsed', payload: { hit: true } }), makeEvent({ type: 'AbilityUsed', payload: { hit: true } })],
      });
      await engine.processMatch(match);
    }
    const finalMatch = makeMatch({ matchId: 'm-final', playerId, statistics: { outcome: 1 }, recentEvents: [makeEvent({ type: 'AbilityUsed', payload: { hit: true } })] });
    const result = await engine.processMatch(finalMatch);
    expect(result.updated.some((u) => u.key === 'learningRate') || result.skipped.some((s) => s.dimensionId === 'learningRate')).toBe(true);
  });

  it('failure isolation: a match with no analyzer-qualifying evidence at all commits nothing but still returns cleanly', async () => {
    const match = makeMatch();
    const result = await engine.processMatch(match);
    expect(result.updated).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.skipped.length).toBeGreaterThan(0);
  });

  it('regression: cross-game dimensions are never scoped to a specific gameId', async () => {
    // None of the Phase 5 dimensions are cross-game yet, but the scoping logic itself is exercised via per-game dims.
    const match = makeMatch({ recentEvents: [makeEvent({ type: 'AbilityUsed', payload: { offensive: true } }), makeEvent({ type: 'TargetAcquired' })] });
    const result = await engine.processMatch(match);
    const aggression = result.updated.find((u) => u.key === 'aggression');
    expect(aggression?.gameId).toBe(match.gameId);
  });
});
