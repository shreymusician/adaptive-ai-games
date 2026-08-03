/**
 * PatternRecognitionEngine — the top-level orchestrator:
 *
 *   Load memory -> Replay match events -> Execute detectors ->
 *   Update pattern confidence -> Commit pattern updates
 *
 * Runs ONLY after MatchEnded (against an already-committed
 * MatchMemoryRecord). Never performs pattern recognition during live
 * gameplay — "replay" here means a single linear pass over the match's
 * already-bounded, already-persisted event log, not live event handling.
 */

import { MemoryEngine, PlayerEpisode } from '@adaptive-ai/memory-engine';
import { PlayerModelingRunResult } from '@adaptive-ai/player-modeling';
import { PatternRegistry } from './registry';
import { PatternStore } from './pattern-store';
import { PatternRecognitionConfig, resolveTuning } from './config';
import { Logger, rootLogger } from './logger';
import { MatchNotCommittedError } from './errors';
import { isPromotion } from './lifecycle';
import { DetectorFailure, DetectorRunContext, MatchMemoryRecord, PatternRecognitionRunResult, PatternRecord, PatternTransitionEvent, SkippedDetector, patternId as makePatternId } from './types';

export interface PatternRecognitionEngineOptions {
  memoryEngine: MemoryEngine;
  patternStore: PatternStore;
  registry: PatternRegistry;
  config: PatternRecognitionConfig;
  logger?: Logger;
}

export class PatternRecognitionEngine {
  private readonly memoryEngine: MemoryEngine;
  private readonly patternStore: PatternStore;
  private readonly registry: PatternRegistry;
  private readonly config: PatternRecognitionConfig;
  private readonly logger: Logger;

  constructor(options: PatternRecognitionEngineOptions) {
    this.memoryEngine = options.memoryEngine;
    this.patternStore = options.patternStore;
    this.registry = options.registry;
    this.config = options.config;
    this.logger = (options.logger ?? rootLogger).child({ component: 'pattern-recognition-engine' });
  }

  /** Must be called once before use — creates PatternStore's indexes. */
  async initialize(): Promise<void> {
    await this.patternStore.ensureIndexes();
    this.logger.info('Pattern Recognition initialized');
  }

  /**
   * Runs the full workflow for one already-committed match. `playerModelingResult`
   * is Player Modeling's output for this SAME match — an allowed input,
   * optional so callers that haven't wired Player Modeling in yet (or are
   * replaying historical matches without it) can still run detectors.
   */
  async processMatch(match: MatchMemoryRecord, playerModelingResult: PlayerModelingRunResult | null = null, now: number = Date.now()): Promise<PatternRecognitionRunResult> {
    if (!match.committedAt) throw new MatchNotCommittedError(match.matchId);

    const [priorPatternsArr, recentEpisodes] = await Promise.all([
      this.patternStore.getForPlayer(match.playerId, match.gameId),
      this.memoryEngine.searchEpisodes({ playerId: match.playerId, gameId: match.gameId, sortBy: 'recent', limit: this.config.episodeLookback }).then((r) => r.episodes),
    ]);
    const priorPatterns = new Map(priorPatternsArr.map((p) => [p.patternId, p]));

    const baseCtx: Omit<DetectorRunContext, 'siblingResults'> = {
      playerId: match.playerId,
      gameId: match.gameId,
      matchId: match.matchId,
      now,
      match,
      playerModelingResult,
      recentEpisodes,
      priorPatterns,
      settings: this.config,
    };

    const { outcomes } = this.registry.execute(baseCtx, match.recentEvents, this.logger);

    const updated: PatternRecord[] = [];
    const promotions: PatternTransitionEvent[] = [];
    const demotions: PatternTransitionEvent[] = [];
    const skipped: SkippedDetector[] = [];
    const errors: DetectorFailure[] = [];

    for (const outcome of outcomes) {
      const meta = this.registry.get(outcome.detectorId)!;
      if (outcome.error) {
        errors.push({ detectorId: outcome.detectorId, error: outcome.error });
        continue;
      }
      const result = outcome.result!;
      if (result.deltas.length === 0) {
        skipped.push({ detectorId: outcome.detectorId, reason: 'no qualifying evidence this match' });
        continue;
      }

      const tuning = resolveTuning(this.config, outcome.detectorId);
      for (const delta of result.deltas) {
        const { record, previousState } = await this.patternStore.upsert({
          playerId: match.playerId,
          gameId: match.gameId,
          detectorId: outcome.detectorId,
          patternKey: delta.patternKey,
          category: meta.category,
          description: delta.description,
          opportunities: delta.opportunities,
          matches: delta.matches,
          matchId: match.matchId,
          now,
          tuning,
          metadata: delta.metadata,
        });
        updated.push(record);

        if (previousState !== record.state) {
          const event: PatternTransitionEvent = {
            patternId: makePatternId(outcome.detectorId, delta.patternKey),
            playerId: match.playerId,
            gameId: match.gameId,
            from: previousState,
            to: record.state,
            confidence: record.confidence,
          };
          if (isPromotion(previousState, record.state)) promotions.push(event);
          else demotions.push(event);
        }
      }
    }

    this.logger.info('Pattern Recognition run complete', {
      playerId: match.playerId,
      gameId: match.gameId,
      matchId: match.matchId,
      updated: updated.length,
      promotions: promotions.length,
      demotions: demotions.length,
      skipped: skipped.length,
      errors: errors.length,
    });

    return { playerId: match.playerId, gameId: match.gameId, matchId: match.matchId, updated, promotions, demotions, skipped, errors, ranAt: now };
  }

  /** Daily-maintenance-cadence dormancy sweep — delegates to PatternStore, not called per-match. */
  async decayDormantPatterns(now: number = Date.now()): Promise<number> {
    return this.patternStore.decayDormantPatterns(this.config, now);
  }
}

export type { PlayerEpisode };
