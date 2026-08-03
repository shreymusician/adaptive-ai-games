/**
 * PlayerModelingEngine — the top-level orchestrator:
 *
 *   Load player memory -> Load match summary -> Execute analyzers ->
 *   Generate updated dimensions -> Commit through Memory Engine
 *
 * Runs ONLY after MatchEnded (i.e. against an already-committed
 * MatchMemoryRecord — see errors.ts's MatchNotCommittedError). Never
 * updates dimensions continuously during gameplay (whitepaper §10).
 *
 * This class performs NO persistence of its own beyond calling through
 * @adaptive-ai/memory-engine's public API — Memory Engine remains the only
 * persistence layer for player knowledge, per this phase's instructions.
 */

import { MemoryEngine, SemanticDimensionState, SemanticDimensionVersion } from '@adaptive-ai/memory-engine';
import { DimensionRegistry } from './registry';
import { PlayerModelingConfig, resolveTuning } from './config';
import { Logger, rootLogger } from './logger';
import { MatchNotCommittedError } from './errors';
import { AnalyzerRunContext, CommittedDimensionUpdate, DimensionAnalyzerMetadata, EpisodeCandidate, MatchMemoryRecord, PlayerModelingRunResult, priorProfileKey, SkippedDimension } from './types';
import { clamp } from './stats';

export interface PlayerModelingEngineOptions {
  memoryEngine: MemoryEngine;
  registry: DimensionRegistry;
  config: PlayerModelingConfig;
  logger?: Logger;
}

export class PlayerModelingEngine {
  private readonly memoryEngine: MemoryEngine;
  private readonly registry: DimensionRegistry;
  private readonly config: PlayerModelingConfig;
  private readonly logger: Logger;

  constructor(options: PlayerModelingEngineOptions) {
    this.memoryEngine = options.memoryEngine;
    this.registry = options.registry;
    this.config = options.config;
    this.logger = (options.logger ?? rootLogger).child({ component: 'player-modeling-engine' });
  }

  /** Every dimension id any registered analyzer needs bounded history for, deduplicated. */
  private historyDependencyIds(): string[] {
    const ids = new Set<string>();
    for (const meta of this.registry.list()) {
      for (const dep of meta.historyDependsOn ?? []) ids.add(dep);
    }
    return [...ids];
  }

  private async prefetchHistory(playerId: string, gameId: string): Promise<Map<string, SemanticDimensionVersion[]>> {
    const series = new Map<string, SemanticDimensionVersion[]>();
    await Promise.all(
      this.historyDependencyIds().map(async (dimension) => {
        const history = await this.memoryEngine.getSemanticHistory(playerId, gameId, dimension, this.config.historyLookbackVersions);
        series.set(dimension, history);
      })
    );
    return series;
  }

  private resolveScope(meta: DimensionAnalyzerMetadata, gameId: string): string | null {
    return meta.scope === 'cross-game' ? null : gameId;
  }

  /**
   * Runs the full Player Modeling workflow for one already-committed match.
   * Analyzers execute in dependency order with failure isolation (one
   * analyzer's error never blocks another's write); every qualifying
   * observation is committed through MemoryEngine.updateSemanticMemory
   * (which performs the authoritative, concurrency-safe EWMA write).
   */
  async processMatch(match: MatchMemoryRecord, now: number = Date.now()): Promise<PlayerModelingRunResult> {
    if (!match.committedAt) throw new MatchNotCommittedError(match.matchId);

    const [priorProfileArr, historicalSeries] = await Promise.all([this.memoryEngine.getSemanticProfile(match.playerId, match.gameId), this.prefetchHistory(match.playerId, match.gameId)]);

    const priorProfile = new Map<string, SemanticDimensionState>(priorProfileArr.map((d) => [priorProfileKey(d.gameId, d.dimension), d]));

    const baseCtx: Omit<AnalyzerRunContext, 'siblingResults'> = {
      playerId: match.playerId,
      gameId: match.gameId,
      matchId: match.matchId,
      now,
      match,
      priorProfile,
      historicalSeries,
      settings: this.config,
    };

    const { instances, outcomes } = this.registry.execute(baseCtx, match.recentEvents, this.logger);

    const updated: CommittedDimensionUpdate[] = [];
    const skipped: SkippedDimension[] = [];
    const errors: { dimensionId: string; error: string }[] = [];
    const episodeCandidates: EpisodeCandidate[] = [];

    for (const outcome of outcomes) {
      const meta = this.registry.get(outcome.dimensionId)!;
      if (outcome.error) {
        errors.push({ dimensionId: outcome.dimensionId, error: outcome.error });
        continue;
      }
      const result = outcome.result!;
      const tuning = resolveTuning(this.config, outcome.dimensionId);
      if (result.entries.length === 0) {
        skipped.push({ dimensionId: outcome.dimensionId, reason: 'no qualifying evidence this match' });
        continue;
      }
      if (result.matchConfidence < tuning.minMatchConfidence) {
        skipped.push({ dimensionId: outcome.dimensionId, reason: `matchConfidence ${result.matchConfidence.toFixed(3)} below gate ${tuning.minMatchConfidence}` });
        continue;
      }

      const scope = this.resolveScope(meta, match.gameId);
      const analyzer = instances.get(outcome.dimensionId)!;

      for (const entry of result.entries) {
        const prior = priorProfile.get(priorProfileKey(scope, entry.key)) ?? null;
        // Local, DB-free preview — used only for episode-candidate deltas; the authoritative write happens below via Memory Engine.
        const preview = analyzer.update(prior ? { value: prior.value, confidence: prior.confidence, samples: prior.samples } : { value: 0, confidence: 0, samples: 0 }, entry.observation, tuning.k, this.config.previewAlphaMin);

        const persisted = await this.memoryEngine.updateSemanticMemory({
          playerId: match.playerId,
          gameId: scope,
          dimension: entry.key,
          observation: entry.observation,
          k: tuning.k,
          matchId: match.matchId,
          reason: `player-modeling:v${meta.version}`,
        });

        updated.push({
          key: entry.key,
          gameId: scope,
          value: persisted.value,
          confidence: persisted.confidence,
          samples: persisted.samples,
          version: persisted.version,
          priorValue: prior?.value ?? null,
        });

        if (prior !== null) {
          const delta = Math.abs(preview.value - prior.value);
          if (delta >= this.config.episodeCandidateMinDelta) {
            episodeCandidates.push(this.buildEpisodeCandidate(match, entry.key, prior.value, preview.value, delta, persisted.confidence));
          }
        }
      }
    }

    for (const candidate of episodeCandidates) {
      if (candidate.stored) {
        await this.memoryEngine.storeEpisode({
          playerId: match.playerId,
          gameId: match.gameId,
          matchId: match.matchId,
          timestamp: now,
          episodeType: candidate.episodeType,
          summary: candidate.summary,
          importance: candidate.importance,
          confidence: candidate.confidence,
          referencedEvents: [],
        });
      }
    }

    this.logger.info('Player Modeling run complete', {
      playerId: match.playerId,
      gameId: match.gameId,
      matchId: match.matchId,
      updated: updated.length,
      skipped: skipped.length,
      errors: errors.length,
      episodeCandidates: episodeCandidates.length,
    });

    return { playerId: match.playerId, gameId: match.gameId, matchId: match.matchId, updated, skipped, errors, episodeCandidates, ranAt: now };
  }

  /**
   * Heuristic episode-candidate generation from a notable dimension swing.
   * Deliberately simple — real salience scoring (whitepaper §5's "requires
   * explicit per-plugin cooperation" caveat and richer significance tests)
   * is Pattern Recognition's future job; this is modeling METADATA output,
   * not a decision, and never claims more than "this dimension moved a lot"
   * (see README "Known limitations").
   */
  private buildEpisodeCandidate(match: MatchMemoryRecord, dimension: string, priorValue: number, newValue: number, delta: number, confidence: number): EpisodeCandidate {
    const importance = clamp(delta, 0, 1);
    const direction = newValue > priorValue ? 'rose' : 'fell';
    const episodeType = direction === 'rose' ? 'repeated-successful-strategy' : 'important-mistake';
    const stored = importance >= this.config.episodeAutoStoreImportance;
    return {
      episodeType,
      summary: `${dimension} ${direction} notably this match (from ${priorValue.toFixed(2)} to ${newValue.toFixed(2)}) in match ${match.matchId}`,
      importance,
      confidence,
      dimension,
      stored,
    };
  }
}
