/**
 * PatternStore — persistence for `PatternRecord`/`PatternVersion`.
 *
 * Memory Engine (Phase 4) implements four whitepaper-defined per-player
 * memory components (Working/Short-Term/Semantic/Episodic) but has no
 * pattern-specific collection — PLATFORM_V2_DESIGN.md §6 flags
 * `playerPatterns` as Pattern Recognition's OWN output collection, never
 * built in Phase 4. Per this phase's instruction to leave Memory Engine
 * untouched, this store owns its collections directly (same `Db`
 * dependency-injection shape Memory Engine's stores use), rather than
 * reaching into or modifying that package. Every detector INPUT still comes
 * through Memory Engine's/Player Modeling's own public APIs — only this
 * package's OWN new output (patterns) is persisted here.
 *
 * Two collections, mirroring Memory Engine's SemanticMemoryStore shape:
 *   - `playerPatterns`        — one doc per (playerId, gameId, patternId): current state.
 *   - `playerPatternVersions` — append-only history, one immutable doc per (patternId, version).
 *
 * Concurrency note: unlike SemanticMemoryStore, this store does NOT
 * implement optimistic-concurrency retry — see README "Known limitations."
 * Pattern Recognition runs are expected to be serialized per match by the
 * caller (one MatchEnded -> one processMatch() call), so a simple
 * read-computed-write is sufficient for the expected access pattern.
 */

import { Collection, Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { applyPatternObservation, decayDormantConfidence } from './confidence';
import { PatternRecognitionConfig, resolveTuning } from './config';
import { nextLifecycleState } from './lifecycle';
import { PatternNotFoundError } from './errors';
import { PatternCategory, PatternRecord, PatternSearchCriteria, PatternTuning, PatternVersion, patternId as makePatternId } from './types';

export interface UpsertPatternInput {
  playerId: string;
  gameId: string;
  detectorId: string;
  patternKey: string;
  category: PatternCategory;
  description: string;
  opportunities: number;
  matches: number;
  matchId: string;
  now: number;
  tuning: PatternTuning;
  metadata?: Record<string, unknown>;
}

export interface UpsertPatternOutcome {
  record: PatternRecord;
  previousState: PatternRecord['state'] | null;
}

export class PatternStore {
  private readonly latest: Collection<PatternRecord>;
  private readonly versions: Collection<PatternVersion>;

  constructor(db: Db) {
    this.latest = db.collection<PatternRecord>('playerPatterns');
    this.versions = db.collection<PatternVersion>('playerPatternVersions');
  }

  async ensureIndexes(): Promise<void> {
    await this.latest.createIndex({ playerId: 1, gameId: 1, patternId: 1 }, { unique: true });
    await this.latest.createIndex({ playerId: 1, gameId: 1, state: 1 });
    await this.latest.createIndex({ playerId: 1, gameId: 1, category: 1 });
    await this.latest.createIndex({ playerId: 1, gameId: 1, confidence: -1 });
    await this.latest.createIndex({ playerId: 1, gameId: 1, lastObservedAt: -1 });
    await this.versions.createIndex({ playerId: 1, gameId: 1, patternId: 1, version: 1 }, { unique: true });
  }

  /** Reads the current record, folds one match's (opportunities, matches) batch into it via the shared confidence/lifecycle primitives, and persists both the new latest doc and an append-only version entry. */
  async upsert(input: UpsertPatternInput): Promise<UpsertPatternOutcome> {
    const id = makePatternId(input.detectorId, input.patternKey);
    const current = await this.latest.findOne({ playerId: input.playerId, gameId: input.gameId, patternId: id });

    const priorConfidenceState = current ? { observationCount: current.observationCount, supportingEvidence: current.supportingEvidence, confidence: current.confidence } : { observationCount: 0, supportingEvidence: 0, confidence: 0 };
    const nextConfidenceState = applyPatternObservation(priorConfidenceState, input.opportunities, input.matches, input.tuning);
    const nextState = nextLifecycleState(current?.state ?? null, nextConfidenceState.confidence, input.tuning.lifecycle);

    const version = (current?.version ?? 0) + 1;
    const record: PatternRecord = {
      playerId: input.playerId,
      gameId: input.gameId,
      detectorId: input.detectorId,
      patternKey: input.patternKey,
      patternId: id,
      category: input.category,
      description: input.description,
      state: nextState,
      observationCount: nextConfidenceState.observationCount,
      supportingEvidence: nextConfidenceState.supportingEvidence,
      confidence: nextConfidenceState.confidence,
      decayRatePerDay: input.tuning.decayRatePerDay,
      promotionThreshold: input.tuning.lifecycle.confirmedConfidence,
      retirementThreshold: input.tuning.lifecycle.retiredConfidence,
      firstDetectedAt: current?.firstDetectedAt ?? input.now,
      lastObservedAt: input.now,
      lastSeenMatchId: input.matchId,
      version,
      metadata: input.metadata ?? current?.metadata ?? {},
    };

    const versionDoc: PatternVersion = {
      ...record,
      previousVersion: current?.version ?? null,
      transition: current && current.state === nextState ? null : { from: current?.state ?? null, to: nextState },
    };

    await this.versions.insertOne(versionDoc);
    await this.latest.updateOne({ playerId: input.playerId, gameId: input.gameId, patternId: id }, { $set: record }, { upsert: true });

    return { record, previousState: current?.state ?? null };
  }

  async getByPatternId(playerId: string, gameId: string, id: string): Promise<PatternRecord | null> {
    return this.latest.findOne({ playerId, gameId, patternId: id });
  }

  async getForPlayer(playerId: string, gameId: string): Promise<PatternRecord[]> {
    return this.latest.find({ playerId, gameId }).toArray();
  }

  async getHistory(playerId: string, gameId: string, id: string, limit: number = 100): Promise<PatternVersion[]> {
    return this.versions.find({ playerId, gameId, patternId: id }).sort({ version: -1 }).limit(limit).toArray();
  }

  /** Search API — player / game / detector-derived category / confidence / recent-activity / state / time-range, per this phase's requirement. */
  async search(criteria: PatternSearchCriteria): Promise<{ patterns: PatternRecord[]; total: number }> {
    const filter: Record<string, unknown> = {};
    if (criteria.playerId !== undefined) filter.playerId = criteria.playerId;
    if (criteria.gameId !== undefined) filter.gameId = criteria.gameId;
    if (criteria.detectorId !== undefined) filter.detectorId = criteria.detectorId;
    if (criteria.category !== undefined) filter.category = criteria.category;
    if (criteria.state !== undefined) filter.state = criteria.state;
    if (criteria.minConfidence !== undefined) filter.confidence = { $gte: criteria.minConfidence };
    if (criteria.observedSince !== undefined) filter.lastObservedAt = { $gte: criteria.observedSince };
    if (criteria.fromTs !== undefined || criteria.toTs !== undefined) {
      filter.firstDetectedAt = {};
      if (criteria.fromTs !== undefined) (filter.firstDetectedAt as Record<string, number>).$gte = criteria.fromTs;
      if (criteria.toTs !== undefined) (filter.firstDetectedAt as Record<string, number>).$lte = criteria.toTs;
    }

    const sort: Record<string, -1> = criteria.sortBy === 'confidence' ? { confidence: -1 } : { lastObservedAt: -1 };
    const limit = criteria.limit ?? 50;
    const offset = criteria.offset ?? 0;

    const [patterns, total] = await Promise.all([this.latest.find(filter).sort(sort).skip(offset).limit(limit).toArray(), this.latest.countDocuments(filter)]);
    return { patterns, total };
  }

  /**
   * Daily-maintenance-cadence sweep (whitepaper §10): decays confidence for
   * every non-retired pattern proportional to days since it was last
   * observed, re-evaluating its lifecycle state afterward. Not called on
   * every match — a separate scheduled operation, exactly like Memory
   * Engine's `pruneExpiredEpisodes`.
   */
  async decayDormantPatterns(config: PatternRecognitionConfig, now: number = Date.now()): Promise<number> {
    const all = await this.latest.find({ state: { $ne: 'retired' } }).toArray();
    let decayed = 0;
    for (const record of all) {
      const daysSince = (now - record.lastObservedAt) / (24 * 60 * 60 * 1000);
      if (daysSince <= 0) continue;
      const confidence = decayDormantConfidence(record.confidence, daysSince, record.decayRatePerDay);
      if (confidence === record.confidence) continue;
      const { lifecycle } = resolveTuning(config, record.detectorId);
      const nextState = nextLifecycleState(record.state, confidence, lifecycle);
      const version = record.version + 1;
      const updated: PatternRecord = { ...record, confidence, state: nextState, version };
      const versionDoc: PatternVersion = { ...updated, previousVersion: record.version, transition: record.state === nextState ? null : { from: record.state, to: nextState } };
      await this.versions.insertOne(versionDoc);
      await this.latest.updateOne({ playerId: record.playerId, gameId: record.gameId, patternId: record.patternId }, { $set: updated });
      decayed += 1;
    }
    return decayed;
  }

  async requireByPatternId(playerId: string, gameId: string, id: string): Promise<PatternRecord> {
    const record = await this.getByPatternId(playerId, gameId, id);
    if (!record) throw new PatternNotFoundError(id);
    return record;
  }

  /** Test/ops helper — new record id for callers that want an explicit identity beyond `patternId` (e.g. external cross-references). */
  static newId(): string {
    return uuidv4();
  }
}
