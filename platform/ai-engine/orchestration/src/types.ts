/**
 * Orchestration domain types.
 *
 * This package performs NO intelligence of its own — it coordinates four
 * already-implemented modules (Event Pipeline, Memory Engine, Player
 * Modeling, Pattern Recognition) into one deterministic MatchEnded workflow:
 *
 *   Gameplay Events -> Event Pipeline -> MatchEnded -> MatchOrchestrator ->
 *   Memory Engine -> Player Modeling -> Pattern Recognition ->
 *   Updated Player Profile -> Updated Pattern Store -> Dashboard/API
 *
 * Every judgment call (what a player's aggression score is, what counts as a
 * pattern) is made by the module that owns that judgment. This package only
 * ever sequences calls, persists a report of what happened, and isolates
 * failures so one stage's error can never corrupt another stage's state.
 */

import { CanonicalEvent } from '@adaptive-ai/sdk-protocol';
import { MatchMemoryRecord } from '@adaptive-ai/memory-engine';
import { PlayerModelingRunResult } from '@adaptive-ai/player-modeling';
import { PatternRecognitionRunResult } from '@adaptive-ai/pattern-recognition';

/**
 * Overall outcome of one MatchEnded run.
 *
 * - `complete`   — every stage (memory commit, player modeling, pattern
 *                  recognition) ran without error.
 * - `partial`    — memory commit succeeded (so the match is durably
 *                  recorded) but at least one downstream stage (player
 *                  modeling and/or pattern recognition) failed. The match is
 *                  never lost; only the derived intelligence is incomplete.
 * - `failed`     — memory commit itself failed. Nothing downstream ran.
 */
export type MatchProcessingStatus = 'complete' | 'partial' | 'failed';

export interface StageError {
  stage: 'memoryCommit' | 'playerModeling' | 'patternRecognition' | 'episodeGeneration';
  message: string;
}

/**
 * The full record of one MatchEnded run — persisted to
 * `matchProcessingReports` and returned synchronously to the caller that
 * triggered completion (e.g. the batch-ingest HTTP response). This is the
 * orchestrator's one piece of durable state, distinct from anything the
 * coordinated modules themselves persist.
 */
export interface MatchProcessingReport {
  reportId: string;
  matchId: string;
  playerId: string;
  gameId: string;
  status: MatchProcessingStatus;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  eventCount: number;
  /** Present only when status is 'complete' or 'partial' — memory commit succeeded. */
  match: MatchMemoryRecord | null;
  playerModeling: PlayerModelingRunResult | null;
  patternRecognition: PatternRecognitionRunResult | null;
  errors: StageError[];
}

/** Emitted on the orchestrator's EventEmitter surface once a match finishes processing (any status). */
export interface MatchCompletedEvent {
  report: MatchProcessingReport;
}

/** One event ingested into a match's live memory, prior to MatchEnded. */
export type IngestableEvent = CanonicalEvent;

export interface OrchestrationConfig {
  /** Ring-buffer style memory caps and other tunables are owned by Memory Engine itself — this package has no config of its own beyond the report retention knob below. */
  reportRetentionCount: number;
}

export function loadOrchestrationConfig(overrides: Partial<OrchestrationConfig> = {}): OrchestrationConfig {
  return {
    reportRetentionCount: 500,
    ...overrides,
  };
}
