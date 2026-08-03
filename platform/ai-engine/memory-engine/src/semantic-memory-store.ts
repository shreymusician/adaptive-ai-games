import { Db, Collection } from 'mongodb';
import { applyObservation, UNOBSERVED_DIMENSION } from './confidence';
import { ConfidenceConfig } from './config';
import { SemanticVersionNotFoundError, SemanticWriteConflictError } from './errors';
import { GameScope, SemanticDimensionState, SemanticDimensionVersion, UpdateSemanticMemoryInput } from './types';

interface DuplicateKeyLike {
  code?: number;
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as DuplicateKeyLike).code === 11000;
}

/**
 * Long-Term Semantic Memory — whitepaper §4: "the aggregated PlayerProfile
 * dimensions themselves — generalized facts stripped of the specific
 * episode that produced them," plus this phase's own requirement that every
 * update version rather than overwrite.
 *
 * Two collections:
 *   - `playerProfiles`         — one doc per (playerId, gameId, dimension):
 *                                 the CURRENT value, for O(1) profile reads.
 *   - `playerProfileVersions`  — append-only history, one immutable doc per
 *                                 (playerId, gameId, dimension, version).
 *
 * Concurrency: updates are optimistic (compare-and-swap on `version`), not
 * lock-based — see `writeNewVersion`'s retry loop. This is what makes
 * concurrent updateSemanticMemory calls for the same dimension safe without
 * ever losing an update, at the cost of a bounded number of retries under
 * contention (see README "Performance" section for the complexity note).
 */
export class SemanticMemoryStore {
  private readonly latest: Collection<SemanticDimensionState>;
  private readonly versions: Collection<SemanticDimensionVersion>;

  constructor(
    db: Db,
    private readonly confidenceConfig: ConfidenceConfig,
    private readonly maxRetries: number
  ) {
    this.latest = db.collection<SemanticDimensionState>('playerProfiles');
    this.versions = db.collection<SemanticDimensionVersion>('playerProfileVersions');
  }

  async ensureIndexes(): Promise<void> {
    await this.latest.createIndex({ playerId: 1, gameId: 1, dimension: 1 }, { unique: true });
    await this.latest.createIndex({ playerId: 1 }); // fast "whole profile" scan
    await this.versions.createIndex({ playerId: 1, gameId: 1, dimension: 1, version: 1 }, { unique: true });
    await this.versions.createIndex({ playerId: 1, gameId: 1, dimension: 1, updatedAt: -1 });
  }

  private resolveK(dimension: string, override?: number): number {
    return override ?? this.confidenceConfig.dimensionK[dimension] ?? this.confidenceConfig.defaultK;
  }

  /** Applies one EWMA observation — whitepaper §3.1 — and persists the result as a new version. */
  async update(input: UpdateSemanticMemoryInput): Promise<SemanticDimensionState> {
    const k = this.resolveK(input.dimension, input.k);
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const currentDoc = await this.latest.findOne({ playerId: input.playerId, gameId: input.gameId, dimension: input.dimension });
      const snapshot = currentDoc ? { value: currentDoc.value, confidence: currentDoc.confidence, samples: currentDoc.samples } : UNOBSERVED_DIMENSION;
      const next = applyObservation(snapshot, input.observation, k, this.confidenceConfig.alphaMin);
      try {
        return await this.writeNewVersionAtBase(input.playerId, input.gameId, input.dimension, currentDoc?.version ?? 0, next, {
          matchId: input.matchId,
          reason: input.reason,
        });
      } catch (err) {
        if (err instanceof RaceLostError) continue; // base moved under us before we could write — recompute EWMA from fresh state
        throw err;
      }
    }
    throw new SemanticWriteConflictError(input.playerId, input.gameId, input.dimension, this.maxRetries);
  }

  /**
   * Core CAS write primitive shared by update() and rollback(): appends a
   * new immutable version at `expectedBaseVersion + 1` and advances the
   * latest-pointer to it. Takes an explicit `expectedBaseVersion` (rather
   * than re-reading internally) so EWMA-dependent callers can detect "the
   * base I computed from is now stale" via RaceLostError and recompute from
   * fresh state, instead of blindly writing a value derived from outdated
   * data. Optimistic concurrency, not lock-based — see class doc.
   */
  private async writeNewVersionAtBase(
    playerId: string,
    gameId: GameScope,
    dimension: string,
    expectedBaseVersion: number,
    next: { value: number; confidence: number; samples: number },
    opts: { matchId?: string; reason?: string }
  ): Promise<SemanticDimensionState> {
    const newVersion = expectedBaseVersion + 1;
    const now = Date.now();
    const versionDoc: SemanticDimensionVersion = {
      playerId,
      gameId,
      dimension,
      value: next.value,
      confidence: next.confidence,
      samples: next.samples,
      version: newVersion,
      updatedAt: now,
      previousVersion: expectedBaseVersion || null,
      ...opts,
    };
    try {
      await this.versions.insertOne(versionDoc as unknown as SemanticDimensionVersion);
    } catch (err) {
      if (isDuplicateKeyError(err)) throw new RaceLostError();
      throw err;
    }
    const result = await this.latest.updateOne(
      { playerId, gameId, dimension, version: expectedBaseVersion },
      { $set: { playerId, gameId, dimension, value: next.value, confidence: next.confidence, samples: next.samples, version: newVersion, updatedAt: now } },
      { upsert: true }
    );
    if (result.matchedCount === 1 || result.upsertedCount === 1) {
      return { playerId, gameId, dimension, value: next.value, confidence: next.confidence, samples: next.samples, version: newVersion, updatedAt: now };
    }
    throw new RaceLostError();
  }

  /** Fetches the current value for one dimension, or null if never observed. */
  async getCurrent(playerId: string, gameId: GameScope, dimension: string): Promise<SemanticDimensionState | null> {
    return this.latest.findOne({ playerId, gameId, dimension });
  }

  /**
   * Fetches every dimension currently known for a player. If `gameId` is
   * given, returns that game's per-game dimensions PLUS cross-game
   * dimensions (gameId=null) — the combined view a Decision Engine would
   * want for a specific match. Omit `gameId` to get every dimension across
   * every game plus cross-game.
   */
  async getProfile(playerId: string, gameId?: GameScope): Promise<SemanticDimensionState[]> {
    if (gameId === undefined) {
      return this.latest.find({ playerId }).toArray();
    }
    const [perGame, crossGame] = await Promise.all([
      this.latest.find({ playerId, gameId }).toArray(),
      gameId === null ? Promise.resolve([]) : this.latest.find({ playerId, gameId: null }).toArray(),
    ]);
    return [...perGame, ...crossGame];
  }

  async getHistory(playerId: string, gameId: GameScope, dimension: string, limit: number = 100): Promise<SemanticDimensionVersion[]> {
    return this.versions.find({ playerId, gameId, dimension }).sort({ version: -1 }).limit(limit).toArray();
  }

  /**
   * Restores a dimension to a prior version's value — implemented as a NEW
   * version copying the historical value forward, never by deleting or
   * mutating existing history (the "never overwrite" requirement applies to
   * rollback too: the fact that a rollback happened is itself preserved).
   */
  async rollback(playerId: string, gameId: GameScope, dimension: string, toVersion: number): Promise<SemanticDimensionState> {
    const target = await this.versions.findOne({ playerId, gameId, dimension, version: toVersion });
    if (!target) throw new SemanticVersionNotFoundError(playerId, gameId, dimension, toVersion);

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const currentDoc = await this.latest.findOne({ playerId, gameId, dimension });
      const baseVersion = currentDoc?.version ?? 0;
      try {
        return await this.writeNewVersionAtBase(
          playerId,
          gameId,
          dimension,
          baseVersion,
          { value: target.value, confidence: target.confidence, samples: target.samples },
          { reason: `rollback-to-v${toVersion}` }
        );
      } catch (err) {
        if (err instanceof RaceLostError) continue;
        throw err;
      }
    }
    throw new SemanticWriteConflictError(playerId, gameId, dimension, this.maxRetries);
  }
}

/** Internal signal: writeNewVersionAtBase lost its CAS race. Caught and retried by callers, never surfaced. */
class RaceLostError extends Error {}
