import { Db, Collection } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { EpisodicMemoryConfig } from './config';
import { InvalidEpisodeError } from './errors';
import { EpisodeSearchCriteria, PlayerEpisode, StoreEpisodeInput } from './types';

/**
 * Long-Term Episodic Memory — collection `playerEpisodes`, per the
 * whitepaper's Schema Note: "a bounded (salience-ranked, top-K per player
 * per game) collection ... distinct from both gameplayEvents (raw,
 * unbounded, everything) and playerPatterns (semantic, aggregated, no
 * specific-encounter detail)."
 *
 * This store does NOT decide what's memorable — `importance` and
 * `confidence` arrive pre-computed from the caller (future Pattern
 * Recognition / Player Modeling). What it owns is faithfully: storing the
 * episode, enforcing the top-K-by-importance retention bound per
 * (playerId, gameId) so the collection never grows unbounded (whitepaper
 * §4: "selective, not exhaustive"), and making the result searchable.
 */
export class EpisodicMemoryStore {
  private readonly episodes: Collection<PlayerEpisode>;

  constructor(
    db: Db,
    private readonly config: EpisodicMemoryConfig
  ) {
    this.episodes = db.collection<PlayerEpisode>('playerEpisodes');
  }

  async ensureIndexes(): Promise<void> {
    await this.episodes.createIndex({ episodeId: 1 }, { unique: true });
    await this.episodes.createIndex({ playerId: 1, gameId: 1, importance: -1 }); // retention pruning + "top episodes"
    await this.episodes.createIndex({ playerId: 1, gameId: 1, timestamp: -1 }); // recency search
    await this.episodes.createIndex({ episodeType: 1 });
    await this.episodes.createIndex({ matchId: 1 });
  }

  private validate(input: StoreEpisodeInput): void {
    if (input.importance < 0 || input.importance > 1) {
      throw new InvalidEpisodeError(`importance must be in [0, 1], got ${input.importance}`);
    }
    if (input.confidence < 0 || input.confidence > 1) {
      throw new InvalidEpisodeError(`confidence must be in [0, 1], got ${input.confidence}`);
    }
    if (!input.summary || input.summary.trim().length === 0) {
      throw new InvalidEpisodeError('summary must be a non-empty string');
    }
  }

  /**
   * Stores an episode and immediately enforces the top-K retention bound for
   * its (playerId, gameId) — an episode that doesn't make the cut when the
   * store is already full is still written, then immediately pruned back
   * out, which is simpler and just as correct as pre-checking, and matches
   * how the collection converges to "top-K" regardless of insert order.
   */
  async store(input: StoreEpisodeInput, now: number = Date.now()): Promise<PlayerEpisode> {
    this.validate(input);
    const episode: PlayerEpisode = {
      episodeId: input.episodeId ?? uuidv4(),
      playerId: input.playerId,
      gameId: input.gameId,
      matchId: input.matchId,
      timestamp: input.timestamp,
      episodeType: input.episodeType,
      summary: input.summary,
      importance: input.importance,
      confidence: input.confidence,
      referencedEvents: input.referencedEvents,
      createdAt: now,
    };
    await this.episodes.insertOne(episode);
    await this.enforceRetention(input.playerId, input.gameId);
    return episode;
  }

  /** Prunes the lowest-importance episodes beyond `maxEpisodesPerPlayerGame` for one (playerId, gameId). */
  private async enforceRetention(playerId: string, gameId: string): Promise<number> {
    const cap = this.config.maxEpisodesPerPlayerGame;
    const all = await this.episodes.find({ playerId, gameId }).sort({ importance: -1 }).toArray();
    if (all.length <= cap) return 0;
    const toRemove = all.slice(cap).map((e) => e.episodeId);
    const { deletedCount } = await this.episodes.deleteMany({ episodeId: { $in: toRemove } });
    return deletedCount;
  }

  /**
   * Time-based expiry sweep, independent of the top-K cap — intended for a
   * daily maintenance cadence (whitepaper §10), not on every write. No-op if
   * `maxAgeMs` isn't configured. Returns the number of episodes removed.
   */
  async pruneExpired(now: number = Date.now()): Promise<number> {
    if (this.config.maxAgeMs === undefined) return 0;
    const cutoff = now - this.config.maxAgeMs;
    const { deletedCount } = await this.episodes.deleteMany({ timestamp: { $lt: cutoff } });
    return deletedCount;
  }

  async getById(episodeId: string): Promise<PlayerEpisode | null> {
    return this.episodes.findOne({ episodeId });
  }

  async search(criteria: EpisodeSearchCriteria): Promise<{ episodes: PlayerEpisode[]; total: number }> {
    const filter: Record<string, unknown> = {};
    if (criteria.playerId !== undefined) filter.playerId = criteria.playerId;
    if (criteria.gameId !== undefined) filter.gameId = criteria.gameId;
    if (criteria.matchId !== undefined) filter.matchId = criteria.matchId;
    if (criteria.episodeType !== undefined) filter.episodeType = criteria.episodeType;
    if (criteria.fromTs !== undefined || criteria.toTs !== undefined) {
      filter.timestamp = {};
      if (criteria.fromTs !== undefined) (filter.timestamp as Record<string, number>).$gte = criteria.fromTs;
      if (criteria.toTs !== undefined) (filter.timestamp as Record<string, number>).$lte = criteria.toTs;
    }
    if (criteria.minImportance !== undefined) filter.importance = { $gte: criteria.minImportance };
    if (criteria.minConfidence !== undefined) filter.confidence = { $gte: criteria.minConfidence };

    const sort: Record<string, -1> = criteria.sortBy === 'importance' ? { importance: -1 } : { timestamp: -1 };
    const limit = criteria.limit ?? 50;
    const offset = criteria.offset ?? 0;

    const [episodes, total] = await Promise.all([
      this.episodes.find(filter).sort(sort).skip(offset).limit(limit).toArray(),
      this.episodes.countDocuments(filter),
    ]);
    return { episodes, total };
  }

  /** Convenience wrapper: the top-N episodes for a player+game by importance — what loadPlayerMemory uses. */
  async getTopEpisodes(playerId: string, gameId: string, limit: number = 10): Promise<PlayerEpisode[]> {
    const { episodes } = await this.search({ playerId, gameId, sortBy: 'importance', limit });
    return episodes;
  }
}
