import { Db } from 'mongodb';
import { MemoryEngineConfig, loadMemoryEngineConfig } from './config';
import { Logger, rootLogger } from './logger';
import { WorkingMemoryStore } from './working-memory-store';
import { ShortTermMemoryStore } from './short-term-memory-store';
import { SemanticMemoryStore } from './semantic-memory-store';
import { EpisodicMemoryStore } from './episodic-memory-store';
import {
  EpisodeSearchCriteria,
  GameScope,
  MatchMemoryRecord,
  PlayerEpisode,
  PlayerMemorySnapshot,
  SemanticDimensionState,
  SemanticDimensionVersion,
  StoreEpisodeInput,
  UpdateSemanticMemoryInput,
  WorkingMemoryState,
} from './types';

export interface MemoryEngineOptions {
  db: Db;
  config?: Partial<MemoryEngineConfig>;
  logger?: Logger;
}

/** storeWorkingMemory() accepts any subset of these — only the fields present are applied. */
export interface StoreWorkingMemoryInput {
  matchId: string;
  /** Required only the first time a matchId is seen — starts a new working-memory session. */
  playerId?: string;
  gameId?: string;
  plan?: Record<string, unknown> | null;
  observation?: { kind: string; payload: Record<string, unknown>; ts?: number };
  counterIncrement?: { name: string; delta?: number };
  context?: Record<string, unknown>;
}

export interface LoadPlayerMemoryOptions {
  recentMatchLimit?: number;
  topEpisodesLimit?: number;
}

/**
 * Public facade for the Memory Engine — ADAPTIVE_AI_ENGINE_WHITEPAPER.md §4.
 *
 * This is the ONLY entry point future AI modules should use to read or write
 * anything about a player. It performs no intelligence: every judgment call
 * (what's an observation worth recording, what a dimension's numeric value
 * should be, what makes an episode important) is supplied by the caller.
 * This class's job is to store it correctly, version it, retain the right
 * subset, and make it queryable — mechanism, not behavior (that split is
 * intentional; see this package's README "Boundary" section).
 */
export class MemoryEngine {
  readonly config: MemoryEngineConfig;
  private readonly logger: Logger;

  readonly workingMemory: WorkingMemoryStore;
  readonly shortTermMemory: ShortTermMemoryStore;
  readonly semanticMemory: SemanticMemoryStore;
  readonly episodicMemory: EpisodicMemoryStore;

  constructor(options: MemoryEngineOptions) {
    this.config = loadMemoryEngineConfig(options.config);
    this.logger = (options.logger ?? rootLogger).child({ component: 'memory-engine' });
    this.workingMemory = new WorkingMemoryStore(this.config.workingMemory);
    this.shortTermMemory = new ShortTermMemoryStore(options.db, this.config.shortTermMemory);
    this.semanticMemory = new SemanticMemoryStore(options.db, this.config.confidence, this.config.semanticWriteMaxRetries);
    this.episodicMemory = new EpisodicMemoryStore(options.db, this.config.episodicMemory);
  }

  /** Must be called once before use — creates required indexes on every AI-engine-owned collection. */
  async initialize(): Promise<void> {
    await Promise.all([this.shortTermMemory.ensureIndexes(), this.semanticMemory.ensureIndexes(), this.episodicMemory.ensureIndexes()]);
    this.logger.info('Memory Engine initialized');
  }

  // -------------------------------------------------------------------
  // Match lifecycle
  // -------------------------------------------------------------------

  /** Starts both Working Memory and Short-Term Memory for a new match. Call once at MatchStarted. */
  startMatch(matchId: string, playerId: string, gameId: string, now: number = Date.now()): { working: WorkingMemoryState } {
    this.workingMemory.start(matchId, playerId, gameId, now);
    this.shortTermMemory.start(matchId, playerId, gameId, now);
    return { working: this.workingMemory.get(matchId)! };
  }

  /**
   * Applies a patch to a match's Working Memory. If the match has no
   * working memory yet, `playerId`/`gameId` must be supplied and a new
   * session is started (equivalent to calling startMatch, minus the
   * short-term half — prefer startMatch() for the normal MatchStarted flow;
   * this exists for callers that only need Working Memory, or that already
   * called startMatch and are just applying an update).
   */
  storeWorkingMemory(input: StoreWorkingMemoryInput, now: number = Date.now()): WorkingMemoryState {
    if (!this.workingMemory.get(input.matchId)) {
      if (!input.playerId || !input.gameId) {
        throw new Error(`storeWorkingMemory: match ${input.matchId} has no working memory yet — playerId and gameId are required to start one`);
      }
      this.workingMemory.start(input.matchId, input.playerId, input.gameId, now);
    }
    if (input.plan !== undefined) this.workingMemory.setPlan(input.matchId, input.plan, now);
    if (input.observation) this.workingMemory.pushObservation(input.matchId, input.observation, now);
    if (input.counterIncrement) this.workingMemory.incrementCounter(input.matchId, input.counterIncrement.name, input.counterIncrement.delta ?? 1, now);
    if (input.context) this.workingMemory.setContext(input.matchId, input.context, now);
    return this.workingMemory.get(input.matchId)!;
  }

  /**
   * Ends a match: persists Short-Term Memory as a durable `matchMemories`
   * record (whitepaper §4: "promoted at MatchEnded") and discards Working
   * Memory (never persisted — it was only ever scratch space for the live
   * match). This is the single point where match-scoped state either
   * survives or is correctly thrown away.
   */
  async commitMatch(matchId: string, summary: string | null = null, now: number = Date.now()): Promise<MatchMemoryRecord> {
    const record = await this.shortTermMemory.commit(matchId, now, summary);
    this.workingMemory.destroy(matchId);
    this.logger.info('Match committed', { matchId, playerId: record.playerId, gameId: record.gameId, durationMs: record.durationMs });
    return record;
  }

  /** Abandons a match without persisting anything — for crashes/disconnects where no durable record should be created. */
  abandonMatch(matchId: string): void {
    this.workingMemory.destroy(matchId);
    this.shortTermMemory.discard(matchId);
    this.logger.warn('Match abandoned — no memory persisted', { matchId });
  }

  /** Sweeps Working Memory for matches idle beyond the configured (or overridden) TTL — crash resilience for matches that never reached MatchEnded. */
  deleteExpiredWorkingMemory(now: number = Date.now(), maxIdleMs?: number): string[] {
    const removed = this.workingMemory.deleteExpired(now, maxIdleMs);
    if (removed.length > 0) this.logger.warn('Swept expired working memory', { matchIds: removed });
    return removed;
  }

  // -------------------------------------------------------------------
  // Semantic memory
  // -------------------------------------------------------------------

  async updateSemanticMemory(input: UpdateSemanticMemoryInput): Promise<SemanticDimensionState> {
    return this.semanticMemory.update(input);
  }

  async getSemanticProfile(playerId: string, gameId?: GameScope): Promise<SemanticDimensionState[]> {
    return this.semanticMemory.getProfile(playerId, gameId);
  }

  async getSemanticHistory(playerId: string, gameId: GameScope, dimension: string, limit?: number): Promise<SemanticDimensionVersion[]> {
    return this.semanticMemory.getHistory(playerId, gameId, dimension, limit);
  }

  async rollbackSemanticDimension(playerId: string, gameId: GameScope, dimension: string, toVersion: number): Promise<SemanticDimensionState> {
    return this.semanticMemory.rollback(playerId, gameId, dimension, toVersion);
  }

  // -------------------------------------------------------------------
  // Episodic memory
  // -------------------------------------------------------------------

  async storeEpisode(input: StoreEpisodeInput): Promise<PlayerEpisode> {
    return this.episodicMemory.store(input);
  }

  async searchEpisodes(criteria: EpisodeSearchCriteria): Promise<{ episodes: PlayerEpisode[]; total: number }> {
    return this.episodicMemory.search(criteria);
  }

  /** Daily-maintenance-cadence op (whitepaper §10) — not called on every write. */
  async pruneExpiredEpisodes(now?: number): Promise<number> {
    return this.episodicMemory.pruneExpired(now);
  }

  // -------------------------------------------------------------------
  // Aggregate read
  // -------------------------------------------------------------------

  /**
   * The "single source of truth" read for any future AI module: everything
   * currently known about a player, optionally scoped to one game. This is
   * the intended default entry point — most consumers should never need to
   * touch the individual stores directly.
   */
  async loadPlayerMemory(playerId: string, gameId?: GameScope, opts: LoadPlayerMemoryOptions = {}): Promise<PlayerMemorySnapshot> {
    const [semanticProfile, recentMatches, topEpisodes] = await Promise.all([
      this.semanticMemory.getProfile(playerId, gameId),
      this.shortTermMemory.getRecentForPlayer(playerId, opts.recentMatchLimit ?? 5),
      gameId ? this.episodicMemory.getTopEpisodes(playerId, gameId, opts.topEpisodesLimit ?? 10) : Promise.resolve([]),
    ]);
    return {
      playerId,
      gameId: gameId ?? null,
      semanticProfile,
      recentMatches,
      topEpisodes,
      loadedAt: Date.now(),
    };
  }
}
