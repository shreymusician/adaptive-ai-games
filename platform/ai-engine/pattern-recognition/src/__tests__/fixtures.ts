import { Db } from 'mongodb';
import { MemoryEngine } from '@adaptive-ai/memory-engine';
import { FakeDb } from './fake-mongo';
import { PatternDetector } from '../detector';
import { loadPatternRecognitionConfig, PatternRecognitionConfig } from '../config';
import { PatternStore } from '../pattern-store';
import { DetectorResult, DetectorRunContext, MatchMemoryRecord, PatternRecord, ShortTermDecisionRef, ShortTermEventRef } from '../types';

export function makeMemoryEngine(): MemoryEngine {
  const db = new FakeDb() as unknown as Db;
  return new MemoryEngine({ db });
}

export function makePatternStore(): PatternStore {
  const db = new FakeDb() as unknown as Db;
  return new PatternStore(db);
}

export function makeConfig(overrides: Partial<PatternRecognitionConfig> = {}): PatternRecognitionConfig {
  return loadPatternRecognitionConfig(overrides);
}

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

export function makeEvent(partial: Partial<ShortTermEventRef> & { type: string }): ShortTermEventRef {
  return { ts: partial.ts ?? Date.now(), eventId: partial.eventId ?? nextId('evt'), type: partial.type, payload: partial.payload ?? {} };
}

export function makeDecision(partial: Partial<ShortTermDecisionRef> = {}): ShortTermDecisionRef {
  return {
    ts: partial.ts ?? Date.now(),
    decisionId: partial.decisionId ?? nextId('dec'),
    chosenAction: partial.chosenAction ?? 'attack',
    context: partial.context ?? {},
  };
}

export function makeMatch(partial: Partial<MatchMemoryRecord> = {}): MatchMemoryRecord {
  return {
    matchId: partial.matchId ?? nextId('match'),
    playerId: partial.playerId ?? 'player-1',
    gameId: partial.gameId ?? 'game-1',
    startedAt: partial.startedAt ?? 0,
    committedAt: partial.committedAt ?? 1000,
    durationMs: partial.durationMs ?? 1000,
    summary: partial.summary ?? null,
    recentEvents: partial.recentEvents ?? [],
    recentBehaviors: partial.recentBehaviors ?? [],
    recentDecisions: partial.recentDecisions ?? [],
    statistics: partial.statistics ?? {},
    schemaVersion: 1,
  };
}

export function makeRunContext(partial: Partial<DetectorRunContext> = {}): DetectorRunContext {
  return {
    playerId: partial.playerId ?? 'player-1',
    gameId: partial.gameId ?? 'game-1',
    matchId: partial.matchId ?? 'match-1',
    now: partial.now ?? Date.now(),
    match: partial.match ?? makeMatch(),
    playerModelingResult: partial.playerModelingResult ?? null,
    recentEpisodes: partial.recentEpisodes ?? [],
    priorPatterns: partial.priorPatterns ?? new Map<string, PatternRecord>(),
    siblingResults: partial.siblingResults ?? new Map<string, DetectorResult>(),
    settings: partial.settings ?? makeConfig(),
  };
}

/** Runs one detector through its full lifecycle (initialize -> consumeEvent* -> consumeMatch -> detect), mirroring what PatternRegistry.execute() does for a single detector. */
export function runDetector(detector: PatternDetector, ctx: DetectorRunContext, events: ShortTermEventRef[] = []): DetectorResult {
  detector.initialize(ctx);
  for (const event of events) detector.consumeEvent(event, ctx);
  detector.consumeMatch(ctx);
  return detector.detect();
}
