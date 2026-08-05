/**
 * MatchOrchestrator — the runtime workflow described in the Phase 6.5
 * mandate:
 *
 *   Gameplay Events -> Event Pipeline -> MatchEnded -> AI Orchestrator ->
 *   Memory Engine -> Player Modeling -> Pattern Recognition ->
 *   Updated Player Profile -> Updated Pattern Store -> Dashboard/API
 *
 * This class coordinates. It contains no AI logic: every judgment call
 * (what a player's aggression score is, what counts as a pattern, what
 * salience an episode has) is made entirely inside Memory Engine / Player
 * Modeling / Pattern Recognition's own code, called here through their
 * public APIs exactly as any other caller would use them.
 *
 * Deterministic execution order, enforced by this class and never
 * bypassable by a caller:
 *
 *   1. Match ends                      (completeMatch() invoked)
 *   2. Working Memory committed        \ MemoryEngine.commitMatch() — one
 *   3. Short-Term Memory stored        / atomic call, in that internal order
 *   4. Player Modeling executed        (also updates Semantic Memory + may
 *                                        propose/store episodes)
 *   5. Pattern Recognition executed    (reads Player Modeling's own-run
 *                                        result as an allowed input)
 *   6. Episodes generated              (a Player Modeling side effect of
 *                                        step 4 — see README "known
 *                                        limitations": Pattern Recognition
 *                                        does not yet generate its own)
 *   7. Report persisted + published    (ReportStore + EventEmitter)
 *
 * No module here is ever called out of this order, and no module is ever
 * skipped silently — a failure downstream of the memory commit is recorded
 * as a StageError on the report, never thrown away.
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { CanonicalEvent } from '@adaptive-ai/sdk-protocol';
import { MemoryEngine, MatchMemoryRecord } from '@adaptive-ai/memory-engine';
import { PlayerModelingEngine, PlayerModelingRunResult } from '@adaptive-ai/player-modeling';
import { PatternRecognitionEngine, PatternRecognitionRunResult } from '@adaptive-ai/pattern-recognition';
import { Logger, rootLogger } from './logger';
import { MatchAlreadyCompletedError, MatchNeverStartedError, MemoryCommitFailedError } from './errors';
import { MatchCompletedEvent, MatchProcessingReport, StageError } from './types';

export interface MatchOrchestratorOptions {
  memoryEngine: MemoryEngine;
  playerModelingEngine: PlayerModelingEngine;
  patternRecognitionEngine: PatternRecognitionEngine;
  logger?: Logger;
}

/**
 * Tracks matches this orchestrator has already committed, so a duplicate or
 * replayed MatchEnded event can never re-run (and re-corrupt-via-double-write)
 * an already-closed match. Bounded by the same lifetime as the process —
 * this is a safety net for the common "at-least-once delivery" case, not a
 * durable dedup log; a genuinely new process restart correctly forgets it
 * (Memory Engine's own `matchMemories` unique index on matchId is the
 * durable backstop — see commitMatch()'s underlying insertOne).
 */
export class MatchOrchestrator extends EventEmitter {
  private readonly memoryEngine: MemoryEngine;
  private readonly playerModelingEngine: PlayerModelingEngine;
  private readonly patternRecognitionEngine: PatternRecognitionEngine;
  private readonly logger: Logger;
  private readonly completedMatchIds = new Set<string>();

  constructor(options: MatchOrchestratorOptions) {
    super();
    this.memoryEngine = options.memoryEngine;
    this.playerModelingEngine = options.playerModelingEngine;
    this.patternRecognitionEngine = options.patternRecognitionEngine;
    this.logger = (options.logger ?? rootLogger).child({ component: 'match-orchestrator' });
  }

  /** True once this match has gone through completeMatch() in this orchestrator's lifetime. */
  isCompleted(matchId: string): boolean {
    return this.completedMatchIds.has(matchId);
  }

  /**
   * Feeds one already-validated, already-persisted (by Event Pipeline)
   * CanonicalEvent into the match's live memory. Starts Working/Short-Term
   * Memory on first contact (equivalent to MatchStarted) if not already
   * running — idempotent per matchId. Never touches Semantic or Episodic
   * Memory; those are Player Modeling's and Pattern Recognition's job,
   * downstream of completeMatch().
   */
  ingestEvent(event: CanonicalEvent): void {
    if (this.completedMatchIds.has(event.matchId)) {
      throw new MatchAlreadyCompletedError(event.matchId);
    }

    if (!this.memoryEngine.workingMemory.get(event.matchId)) {
      this.memoryEngine.startMatch(event.matchId, event.playerId, event.gameId, event.ts);
    }

    this.memoryEngine.shortTermMemory.recordEvent(event.matchId, {
      ts: event.ts,
      type: event.type,
      payload: event.payload,
    });

    if (event.type === 'DecisionPoint') {
      this.memoryEngine.shortTermMemory.recordDecision(event.matchId, {
        ts: event.ts,
        chosenAction: typeof event.payload.chosenAction === 'string' ? event.payload.chosenAction : 'unknown',
        context: event.payload,
      });
    }
  }

  /**
   * Runs the full MatchEnded workflow for a match whose events have already
   * been ingested via ingestEvent(). This is the single entry point that
   * turns a live match into an updated player profile and pattern set.
   *
   * Failure isolation contract:
   *   - If the memory commit itself fails, the run is FATAL: nothing
   *     downstream is attempted, and the thrown error propagates to the
   *     caller (there is no MatchMemoryRecord to build a report around).
   *     Working/Short-Term Memory are left exactly as Memory Engine's own
   *     commitMatch() left them — it never partially applies.
   *   - Once the commit succeeds, every further stage is wrapped
   *     independently. A Player Modeling failure is recorded as a
   *     StageError and does NOT prevent Pattern Recognition from running
   *     (it accepts a null playerModelingResult by design). A Pattern
   *     Recognition failure is likewise recorded and never re-thrown.
   *   - The match is marked completed (and further ingestEvent/completeMatch
   *     calls for it rejected) the moment the memory commit succeeds,
   *     regardless of what happens downstream — a match is never
   *     "reopened" to retry a failed analysis stage from this API; retrying
   *     analysis for an already-committed match is a distinct, safe
   *     operation (re-running processMatch against the same
   *     MatchMemoryRecord) that a caller can perform via the engines
   *     directly if needed.
   */
  async completeMatch(matchId: string, now: number = Date.now()): Promise<MatchProcessingReport> {
    if (this.completedMatchIds.has(matchId)) {
      throw new MatchAlreadyCompletedError(matchId);
    }
    if (!this.memoryEngine.workingMemory.get(matchId) && !this.memoryEngine.shortTermMemory.get(matchId)) {
      throw new MatchNeverStartedError(matchId);
    }

    const startedAt = Date.now();
    const errors: StageError[] = [];

    // ---------------------------------------------------------------
    // Stage 1: Working Memory committed / Short-Term Memory stored.
    // Fatal on failure — nothing downstream has anything to read. Wrapped
    // in the orchestrator's own error type so callers never need to know
    // Memory Engine's internal error hierarchy to handle this correctly.
    // ---------------------------------------------------------------
    let match: MatchMemoryRecord;
    try {
      match = await this.memoryEngine.commitMatch(matchId, null, now);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('Memory commit failed — fatal, nothing downstream will run', { matchId, error: message });
      throw new MemoryCommitFailedError(matchId, message);
    }
    this.completedMatchIds.add(matchId);

    // ---------------------------------------------------------------
    // Stage 2: Player Modeling — updates Semantic Memory, may store
    // episode candidates as a side effect of its own processMatch().
    // ---------------------------------------------------------------
    let playerModeling: PlayerModelingRunResult | null = null;
    try {
      playerModeling = await this.playerModelingEngine.processMatch(match, now);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('Player Modeling stage failed — isolated, Pattern Recognition still runs', { matchId, error: message });
      errors.push({ stage: 'playerModeling', message });
    }

    // ---------------------------------------------------------------
    // Stage 3: Pattern Recognition — reads Player Modeling's own-run
    // result if available, but explicitly tolerates null (an allowed
    // input per PatternRecognitionEngine's own contract).
    // ---------------------------------------------------------------
    let patternRecognition: PatternRecognitionRunResult | null = null;
    try {
      patternRecognition = await this.patternRecognitionEngine.processMatch(match, playerModeling, now);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('Pattern Recognition stage failed — isolated', { matchId, error: message });
      errors.push({ stage: 'patternRecognition', message });
    }

    const completedAt = Date.now();
    const status: MatchProcessingReport['status'] = errors.length === 0 ? 'complete' : 'partial';

    const report: MatchProcessingReport = {
      reportId: uuidv4(),
      matchId: match.matchId,
      playerId: match.playerId,
      gameId: match.gameId,
      status,
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
      eventCount: match.recentEvents.length,
      match,
      playerModeling,
      patternRecognition,
      errors,
    };

    this.logger.info('Match processing complete', {
      matchId,
      status,
      durationMs: report.durationMs,
      updatedDimensions: playerModeling?.updated.length ?? 0,
      updatedPatterns: patternRecognition?.updated.length ?? 0,
      errorCount: errors.length,
    });

    const payload: MatchCompletedEvent = { report };
    this.emit('match:completed', payload);

    return report;
  }
}
