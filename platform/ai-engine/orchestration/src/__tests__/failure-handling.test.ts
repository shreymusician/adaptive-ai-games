/**
 * Failure-handling contract tests — verifies the isolation guarantees
 * documented on MatchOrchestrator.completeMatch():
 *
 *   - A Player Modeling failure never corrupts memory and never blocks
 *     Pattern Recognition (which explicitly tolerates a null result).
 *   - A Pattern Recognition failure never corrupts memory and never hides
 *     a successful Player Modeling result.
 *   - A Memory Engine commit failure is fatal (nothing downstream runs) but
 *     leaves in-process Short-Term Memory intact for a safe retry — it
 *     never partially applies.
 *   - Every failure produces a structured StageError, never a silently
 *     swallowed or silently corrupted result.
 */

import { Db } from 'mongodb';
import { describe, it, expect } from 'vitest';
import { MemoryEngine } from '@adaptive-ai/memory-engine';
import { DimensionRegistry, PlayerModelingEngine, loadPlayerModelingConfig, registerAllAnalyzers } from '@adaptive-ai/player-modeling';
import { PatternRegistry, PatternStore, PatternRecognitionEngine, loadPatternRecognitionConfig, registerAllDetectors } from '@adaptive-ai/pattern-recognition';
import { MatchOrchestrator } from '../match-orchestrator';
import { MemoryCommitFailedError } from '../errors';
import { FakeDb } from './fake-mongo';
import { buildMatchEvents } from './fixtures';
import { CanonicalEvent } from '@adaptive-ai/sdk-protocol';

const PLAYER_ID = 'player-1';
const GAME_ID = 'game-1';

function toCanonical(matchId: string, raw: ReturnType<typeof buildMatchEvents>[number]): CanonicalEvent {
  return { matchId, playerId: PLAYER_ID, gameId: GAME_ID, seq: raw.seq, ts: raw.ts, type: raw.type as CanonicalEvent['type'], payload: raw.payload, schemaVersion: '1' };
}

/** Builds the same real stack the bootstrap composition root would, but exposes the raw FakeDb + individual engines so a test can substitute a throwing stub for exactly one stage. */
async function buildRawStack() {
  const fakeDb = new FakeDb();
  const db = fakeDb as unknown as Db;

  const memoryEngine = new MemoryEngine({ db });
  await memoryEngine.initialize();

  const dimensionRegistry = new DimensionRegistry();
  registerAllAnalyzers(dimensionRegistry);
  const playerModelingEngine = new PlayerModelingEngine({ memoryEngine, registry: dimensionRegistry, config: loadPlayerModelingConfig() });

  const patternRegistry = new PatternRegistry();
  registerAllDetectors(patternRegistry);
  const patternStore = new PatternStore(db);
  const patternRecognitionEngine = new PatternRecognitionEngine({ memoryEngine, patternStore, registry: patternRegistry, config: loadPatternRecognitionConfig() });
  await patternRecognitionEngine.initialize();

  return { fakeDb, memoryEngine, playerModelingEngine, patternRecognitionEngine, patternStore };
}

class ThrowingPlayerModelingEngine {
  async processMatch(): Promise<never> {
    throw new Error('simulated Player Modeling failure');
  }
}

class ThrowingPatternRecognitionEngine {
  async processMatch(): Promise<never> {
    throw new Error('simulated Pattern Recognition failure');
  }
}

describe('MatchOrchestrator failure handling', () => {
  it('isolates a Player Modeling failure: memory still commits, Pattern Recognition still runs, report is "partial" with a structured error', async () => {
    const { memoryEngine, patternRecognitionEngine, patternStore } = await buildRawStack();
    const orchestrator = new MatchOrchestrator({
      memoryEngine,
      playerModelingEngine: new ThrowingPlayerModelingEngine() as unknown as PlayerModelingEngine,
      patternRecognitionEngine,
    });

    const matchId = 'pm-failure-match';
    for (const r of buildMatchEvents(Date.now())) orchestrator.ingestEvent(toCanonical(matchId, r));

    const report = await orchestrator.completeMatch(matchId);

    expect(report.status).toBe('partial');
    expect(report.errors).toEqual([{ stage: 'playerModeling', message: 'simulated Player Modeling failure' }]);

    // Memory commit succeeded and is durably queryable — never lost.
    expect(report.match).not.toBeNull();
    const stored = await memoryEngine.shortTermMemory.getByMatchId(matchId);
    expect(stored).not.toBeNull();

    // Pattern Recognition still ran, with a null playerModelingResult — an explicitly allowed input.
    expect(report.patternRecognition).not.toBeNull();
    expect(report.patternRecognition!.updated.length).toBeGreaterThan(0);
    const { patterns } = await patternStore.search({ playerId: PLAYER_ID, gameId: GAME_ID });
    expect(patterns.length).toBeGreaterThan(0);

    // No semantic dimensions were written — Player Modeling never ran to write any.
    const profile = await memoryEngine.getSemanticProfile(PLAYER_ID, GAME_ID);
    expect(profile).toEqual([]);
  });

  it('isolates a Pattern Recognition failure: memory and Player Modeling results are unaffected, report is "partial"', async () => {
    const { memoryEngine, playerModelingEngine, patternStore } = await buildRawStack();
    const orchestrator = new MatchOrchestrator({
      memoryEngine,
      playerModelingEngine,
      patternRecognitionEngine: new ThrowingPatternRecognitionEngine() as unknown as PatternRecognitionEngine,
    });

    const matchId = 'pr-failure-match';
    for (const r of buildMatchEvents(Date.now())) orchestrator.ingestEvent(toCanonical(matchId, r));

    const report = await orchestrator.completeMatch(matchId);

    expect(report.status).toBe('partial');
    expect(report.errors).toEqual([{ stage: 'patternRecognition', message: 'simulated Pattern Recognition failure' }]);

    // Player Modeling's result is fully present and was actually committed.
    expect(report.playerModeling).not.toBeNull();
    expect(report.playerModeling!.updated.length).toBeGreaterThan(0);
    const profile = await memoryEngine.getSemanticProfile(PLAYER_ID, GAME_ID);
    expect(profile.length).toBeGreaterThan(0);

    // No patterns were written — Pattern Recognition never ran to write any.
    const { patterns } = await patternStore.search({ playerId: PLAYER_ID, gameId: GAME_ID });
    expect(patterns).toEqual([]);

    expect(report.patternRecognition).toBeNull();
  });

  it('a Memory Engine commit failure is fatal, never partially applies, and leaves in-process state intact for a safe retry', async () => {
    const { fakeDb, memoryEngine, playerModelingEngine, patternRecognitionEngine } = await buildRawStack();
    const orchestrator = new MatchOrchestrator({ memoryEngine, playerModelingEngine, patternRecognitionEngine });

    const matchId = 'commit-failure-match';
    for (const r of buildMatchEvents(Date.now())) orchestrator.ingestEvent(toCanonical(matchId, r));

    // Force the underlying matchMemories.insertOne() to fail once.
    fakeDb.collection('matchMemories').failNext = new Error('simulated database outage');

    await expect(orchestrator.completeMatch(matchId)).rejects.toThrow(MemoryCommitFailedError);

    // The match was never marked completed — retry is possible.
    expect(orchestrator.isCompleted(matchId)).toBe(false);

    // In-process Short-Term Memory is still there (commit never partially
    // applied — ShortTermMemoryStore only deletes its in-process copy
    // AFTER insertOne succeeds).
    expect(memoryEngine.shortTermMemory.get(matchId)).not.toBeNull();

    // No matchMemories document exists — the failed write left nothing behind.
    const stored = await memoryEngine.shortTermMemory.getByMatchId(matchId);
    expect(stored).toBeNull();

    // Nothing downstream ran at all.
    const profile = await memoryEngine.getSemanticProfile(PLAYER_ID, GAME_ID);
    expect(profile).toEqual([]);

    // Retrying (now that the simulated outage is over) succeeds cleanly.
    const report = await orchestrator.completeMatch(matchId);
    expect(report.status).toBe('complete');
    expect(orchestrator.isCompleted(matchId)).toBe(true);
  });

  it('both Player Modeling and Pattern Recognition failing simultaneously still commits memory and reports both structured errors', async () => {
    const { memoryEngine } = await buildRawStack();
    const orchestrator = new MatchOrchestrator({
      memoryEngine,
      playerModelingEngine: new ThrowingPlayerModelingEngine() as unknown as PlayerModelingEngine,
      patternRecognitionEngine: new ThrowingPatternRecognitionEngine() as unknown as PatternRecognitionEngine,
    });

    const matchId = 'double-failure-match';
    for (const r of buildMatchEvents(Date.now())) orchestrator.ingestEvent(toCanonical(matchId, r));

    const report = await orchestrator.completeMatch(matchId);

    expect(report.status).toBe('partial');
    expect(report.errors).toHaveLength(2);
    expect(report.errors.map((e) => e.stage).sort()).toEqual(['patternRecognition', 'playerModeling']);
    expect(report.match).not.toBeNull();

    const stored = await memoryEngine.shortTermMemory.getByMatchId(matchId);
    expect(stored).not.toBeNull();
  });
});
