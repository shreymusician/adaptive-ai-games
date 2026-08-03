import { Db } from 'mongodb';
import { MemoryEngine } from '@adaptive-ai/memory-engine';
import { FakeDb } from './fake-mongo';
import { DimensionAnalyzer } from '../analyzer';
import { loadPlayerModelingConfig, PlayerModelingConfig } from '../config';
import { AnalyzerRunContext, DimensionAnalyzerResult, MatchMemoryRecord, ShortTermDecisionRef, ShortTermEventRef } from '../types';

export function makeMemoryEngine(): MemoryEngine {
  const db = new FakeDb() as unknown as Db;
  return new MemoryEngine({ db });
}

export function makeConfig(overrides: Partial<PlayerModelingConfig> = {}): PlayerModelingConfig {
  return loadPlayerModelingConfig(overrides);
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

/** Builds a minimal AnalyzerRunContext for unit-testing a single analyzer directly, without a registry or Memory Engine. */
export function makeRunContext(partial: Partial<AnalyzerRunContext> = {}): AnalyzerRunContext {
  return {
    playerId: partial.playerId ?? 'player-1',
    gameId: partial.gameId ?? 'game-1',
    matchId: partial.matchId ?? 'match-1',
    now: partial.now ?? Date.now(),
    match: partial.match ?? makeMatch(),
    priorProfile: partial.priorProfile ?? new Map(),
    siblingResults: partial.siblingResults ?? new Map(),
    historicalSeries: partial.historicalSeries ?? new Map(),
    settings: partial.settings ?? makeConfig(),
  };
}

/** Runs one analyzer through its full lifecycle (initialize -> consumeEvent* -> consumeMatch -> calculate) in isolation, mirroring what DimensionRegistry.execute() does for a single analyzer. */
export function runAnalyzer(analyzer: DimensionAnalyzer, ctx: AnalyzerRunContext, events: ShortTermEventRef[] = []): DimensionAnalyzerResult {
  analyzer.initialize(ctx);
  for (const event of events) analyzer.consumeEvent(event, ctx);
  analyzer.consumeMatch(ctx);
  return analyzer.calculate();
}
