import { Db, Collection, Filter } from 'mongodb';
import { CanonicalEvent, CanonicalEventType } from '@adaptive-ai/sdk-protocol';
import { v4 as uuidv4 } from 'uuid';
import { StoredEvent } from './types';

/** Manages event persistence and retrieval */
export class EventStore {
  private db: Db;
  private events: Collection<StoredEvent>;
  private batches: Collection;

  constructor(db: Db) {
    this.db = db;
    this.events = db.collection<StoredEvent>('gameplayEvents');
    this.batches = db.collection('eventBatches');
  }

  /** Pings the database and returns round-trip latency in ms. Throws if unreachable. */
  async ping(): Promise<number> {
    const start = Date.now();
    await this.db.command({ ping: 1 });
    return Date.now() - start;
  }

  /** Total events ever stored — used for /health reporting, not a hot path. */
  async getTotalEventCount(): Promise<number> {
    return this.events.estimatedDocumentCount();
  }

  /** Total batches ever recorded — used for /health reporting. */
  async getTotalBatchCount(): Promise<number> {
    return this.batches.estimatedDocumentCount();
  }

  /** Most recently persisted event across all matches, for /health "last event" reporting. */
  async getMostRecentEvent(): Promise<StoredEvent | null> {
    return this.events.findOne({}, { sort: { serverTs: -1 } });
  }

  /** Initializes indexes for optimal query performance */
  async ensureIndexes(): Promise<void> {
    await this.events.createIndex({ matchId: 1, seq: 1 }, { unique: true });
    await this.events.createIndex({ matchId: 1, ts: 1 });
    await this.events.createIndex({ playerId: 1, ts: 1 });
    await this.events.createIndex({ gameId: 1, ts: 1 });
    await this.events.createIndex({ type: 1 });
    await this.events.createIndex({ serverTs: 1 });
  }

  /** Stores a single event (immutable, append-only) */
  async storeEvent(
    event: CanonicalEvent,
    validationStatus: 'valid' | 'warning' = 'valid',
    sourcePlugin: string = 'unknown'
  ): Promise<StoredEvent> {
    const stored: StoredEvent = {
      ...event,
      eventId: `${event.matchId}-${event.seq}-${uuidv4().slice(0, 8)}`,
      serverTs: Date.now(),
      validationStatus,
      sourcePlugin,
    };

    await this.events.insertOne(stored);
    return stored;
  }

  /** Stores multiple events atomically */
  async storeEvents(
    events: Array<{
      event: CanonicalEvent;
      validationStatus?: 'valid' | 'warning';
      sourcePlugin?: string;
    }>
  ): Promise<StoredEvent[]> {
    const now = Date.now();
    const storedEvents = events.map((e) => ({
      ...e.event,
      eventId: `${e.event.matchId}-${e.event.seq}-${uuidv4().slice(0, 8)}`,
      serverTs: now,
      validationStatus: e.validationStatus || 'valid',
      sourcePlugin: e.sourcePlugin || 'unknown',
    }));

    if (storedEvents.length > 0) {
      await this.events.insertMany(storedEvents);
    }
    return storedEvents;
  }

  /** Records a batch ingestion result */
  async recordBatch(
    batchId: string,
    matchId: string,
    playerId: string,
    eventCount: number,
    processingTimeMs: number
  ): Promise<void> {
    await this.batches.insertOne({
      batchId,
      matchId,
      playerId,
      eventCount,
      size: 0,
      receivedAt: new Date(),
      processingTime: processingTimeMs,
      status: 'accepted',
      errors: [],
    });
  }

  /** Retrieves all events for a match */
  async getMatchEvents(matchId: string, limit: number = 100, offset: number = 0): Promise<{ events: StoredEvent[]; total: number }> {
    const [events, total] = await Promise.all([
      this.events.find({ matchId }).sort({ seq: 1 }).skip(offset).limit(limit).toArray(),
      this.events.countDocuments({ matchId }),
    ]);
    return { events, total };
  }

  /** Retrieves all events for a player */
  async getPlayerEvents(playerId: string, limit: number = 100, offset: number = 0): Promise<{ events: StoredEvent[]; total: number }> {
    const [events, total] = await Promise.all([
      this.events.find({ playerId }).sort({ serverTs: -1 }).skip(offset).limit(limit).toArray(),
      this.events.countDocuments({ playerId }),
    ]);
    return { events, total };
  }

  /** Retrieves all events for a game */
  async getGameEvents(gameId: string, limit: number = 100, offset: number = 0): Promise<{ events: StoredEvent[]; total: number }> {
    const [events, total] = await Promise.all([
      this.events.find({ gameId }).sort({ serverTs: -1 }).skip(offset).limit(limit).toArray(),
      this.events.countDocuments({ gameId }),
    ]);
    return { events, total };
  }

  /** Replays events for a match in a time window */
  async replayMatch(matchId: string, fromSeq?: number, toSeq?: number): Promise<StoredEvent[]> {
    const filter: Record<string, any> = { matchId };
    if (fromSeq !== undefined || toSeq !== undefined) {
      filter.seq = {};
      if (fromSeq !== undefined) filter.seq.$gte = fromSeq;
      if (toSeq !== undefined) filter.seq.$lte = toSeq;
    }
    return this.events.find(filter as Filter<StoredEvent>).sort({ seq: 1 }).toArray();
  }

  /** Detects duplicate events (by matchId + seq) */
  async isDuplicate(matchId: string, seq: number): Promise<boolean> {
    const existing = await this.events.findOne({ matchId, seq });
    return existing !== null;
  }

  /**
   * Batch duplicate check: returns the subset of `seqs` that already exist
   * for `matchId`, in a single query. Used by EventProcessor instead of one
   * isDuplicate() round trip per event, which does not scale to
   * 1000-event batches.
   */
  async getExistingSeqs(matchId: string, seqs: number[]): Promise<Set<number>> {
    if (seqs.length === 0) return new Set();
    const docs = await this.events.find({ matchId, seq: { $in: seqs } }, { projection: { seq: 1 } }).toArray();
    return new Set(docs.map((d) => d.seq));
  }

  /** Gets last sequence number for a match */
  async getLastSequence(matchId: string): Promise<number> {
    const last = await this.events.findOne({ matchId }, { sort: { seq: -1 } });
    return last ? last.seq : 0;
  }

  /** Gets event count for a match */
  async getEventCount(matchId: string): Promise<number> {
    return this.events.countDocuments({ matchId });
  }

  /** Gets events by type */
  async getEventsByType(eventType: CanonicalEventType, limit: number = 100): Promise<StoredEvent[]> {
    return this.events.find({ type: eventType }).sort({ serverTs: -1 }).limit(limit).toArray();
  }

  /**
   * General-purpose replay query backing GET /api/events/replay — supports
   * any combination of match/player/game scoping plus a sequence range
   * and/or a server-timestamp window. Returned in seq order when scoped to
   * a single match (deterministic replay), otherwise in serverTs order.
   */
  async queryEvents(
    criteria: {
      matchId?: string;
      playerId?: string;
      gameId?: string;
      fromSeq?: number;
      toSeq?: number;
      fromTs?: number;
      toTs?: number;
      type?: CanonicalEventType;
    },
    limit: number = 100,
    offset: number = 0
  ): Promise<{ events: StoredEvent[]; total: number }> {
    const filter: Record<string, any> = {};
    if (criteria.matchId) filter.matchId = criteria.matchId;
    if (criteria.playerId) filter.playerId = criteria.playerId;
    if (criteria.gameId) filter.gameId = criteria.gameId;
    if (criteria.type) filter.type = criteria.type;
    if (criteria.fromSeq !== undefined || criteria.toSeq !== undefined) {
      filter.seq = {};
      if (criteria.fromSeq !== undefined) filter.seq.$gte = criteria.fromSeq;
      if (criteria.toSeq !== undefined) filter.seq.$lte = criteria.toSeq;
    }
    if (criteria.fromTs !== undefined || criteria.toTs !== undefined) {
      filter.serverTs = {};
      if (criteria.fromTs !== undefined) filter.serverTs.$gte = criteria.fromTs;
      if (criteria.toTs !== undefined) filter.serverTs.$lte = criteria.toTs;
    }

    const sort: Record<string, 1> = criteria.matchId ? { seq: 1 } : { serverTs: 1 };

    const [events, total] = await Promise.all([
      this.events.find(filter as Filter<StoredEvent>).sort(sort).skip(offset).limit(limit).toArray(),
      this.events.countDocuments(filter as Filter<StoredEvent>),
    ]);
    return { events, total };
  }
}
