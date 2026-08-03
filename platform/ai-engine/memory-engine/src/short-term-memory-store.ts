import { Db, Collection } from 'mongodb';
import { ShortTermMemoryConfig } from './config';
import { ShortTermMemoryNotFoundError } from './errors';
import { MatchMemoryRecord, ShortTermBehaviorObservation, ShortTermDecisionRef, ShortTermEventRef, ShortTermMemoryState } from './types';

/**
 * Short-Term Memory — whitepaper §4: "the current match's accumulated raw
 * observations *before* they're folded into the persisted profile ... the
 * per-match observation log, promoted at MatchEnded."
 *
 * Accumulates in-process during the match (same cost profile as Working
 * Memory — free, no persistence), but unlike Working Memory it is NOT
 * discarded at match end: `commit()` writes it to the `matchMemories`
 * collection as a durable summary that Player Modeling will later consume.
 * This is a deliberately separate collection from the platform's own
 * `matches` collection (owned by platform/api / event-pipeline per
 * PLATFORM_V2_DESIGN.md §6 — match metadata like outcome/duration/AI
 * personality) — Memory Engine owns the *observation log* for a match, not
 * the match's own lifecycle record.
 */
export class ShortTermMemoryStore {
  private readonly matches = new Map<string, ShortTermMemoryState>();
  private readonly matchMemories: Collection<MatchMemoryRecord>;

  constructor(
    db: Db,
    private readonly config: ShortTermMemoryConfig
  ) {
    this.matchMemories = db.collection<MatchMemoryRecord>('matchMemories');
  }

  async ensureIndexes(): Promise<void> {
    await this.matchMemories.createIndex({ matchId: 1 }, { unique: true });
    await this.matchMemories.createIndex({ playerId: 1, committedAt: -1 });
    await this.matchMemories.createIndex({ gameId: 1, committedAt: -1 });
  }

  start(matchId: string, playerId: string, gameId: string, now: number = Date.now()): ShortTermMemoryState {
    const state: ShortTermMemoryState = {
      matchId,
      playerId,
      gameId,
      startedAt: now,
      recentEvents: [],
      recentBehaviors: [],
      recentDecisions: [],
      statistics: {},
    };
    this.matches.set(matchId, state);
    return state;
  }

  get(matchId: string): ShortTermMemoryState | null {
    return this.matches.get(matchId) ?? null;
  }

  private require(matchId: string): ShortTermMemoryState {
    const state = this.matches.get(matchId);
    if (!state) throw new ShortTermMemoryNotFoundError(matchId);
    return state;
  }

  recordEvent(matchId: string, event: ShortTermEventRef): void {
    const state = this.require(matchId);
    state.recentEvents.push(event);
    if (state.recentEvents.length > this.config.maxEvents) {
      state.recentEvents.splice(0, state.recentEvents.length - this.config.maxEvents);
    }
  }

  recordBehavior(matchId: string, observation: ShortTermBehaviorObservation): void {
    const state = this.require(matchId);
    state.recentBehaviors.push(observation);
    if (state.recentBehaviors.length > this.config.maxBehaviors) {
      state.recentBehaviors.splice(0, state.recentBehaviors.length - this.config.maxBehaviors);
    }
  }

  recordDecision(matchId: string, decision: ShortTermDecisionRef): void {
    const state = this.require(matchId);
    state.recentDecisions.push(decision);
    if (state.recentDecisions.length > this.config.maxDecisions) {
      state.recentDecisions.splice(0, state.recentDecisions.length - this.config.maxDecisions);
    }
  }

  incrementStatistic(matchId: string, name: string, delta: number = 1): void {
    const state = this.require(matchId);
    state.statistics[name] = (state.statistics[name] ?? 0) + delta;
  }

  /**
   * Persists the in-process state as a `matchMemories` document and drops
   * the in-process copy. Idempotent at the storage layer via a unique index
   * on `matchId` — a second commit for the same match is rejected by the
   * caller (MemoryEngine.commitMatch), not silently overwritten here, since
   * "commit" should be a one-time event per match.
   */
  async commit(matchId: string, now: number = Date.now(), summary: string | null = null): Promise<MatchMemoryRecord> {
    const state = this.require(matchId);
    const record: MatchMemoryRecord = {
      matchId: state.matchId,
      playerId: state.playerId,
      gameId: state.gameId,
      startedAt: state.startedAt,
      committedAt: now,
      durationMs: now - state.startedAt,
      summary,
      recentEvents: state.recentEvents,
      recentBehaviors: state.recentBehaviors,
      recentDecisions: state.recentDecisions,
      statistics: state.statistics,
      schemaVersion: 1,
    };
    await this.matchMemories.insertOne(record as unknown as MatchMemoryRecord);
    this.matches.delete(matchId);
    return record;
  }

  /** Discards in-process state WITHOUT persisting — for abandoned/crashed matches that should not produce a match-memory record. */
  discard(matchId: string): boolean {
    return this.matches.delete(matchId);
  }

  async getRecentForPlayer(playerId: string, limit: number = 10): Promise<MatchMemoryRecord[]> {
    return this.matchMemories.find({ playerId }).sort({ committedAt: -1 }).limit(limit).toArray();
  }

  async getByMatchId(matchId: string): Promise<MatchMemoryRecord | null> {
    return this.matchMemories.findOne({ matchId });
  }

  /** Test/ops helper: how many matches currently hold uncommitted short-term memory. */
  size(): number {
    return this.matches.size;
  }
}
