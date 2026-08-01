import { Db, Collection, Filter } from 'mongodb';
import { CanonicalEvent } from '@adaptive-ai/sdk-protocol';
import { v4 as uuidv4 } from 'uuid';
import { StoredEvent } from './types';

/** Manages event persistence and retrieval */
export class EventStore {
  private events: Collection<StoredEvent>;
  private batches: Collection;

  constructor(db: Db) {
    this.events = db.collection<StoredEvent>('gameplayEvents');
    this.batches = db.collection('eventBatches');
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
    const filter: Filter<StoredEvent> = { matchId };
    if (fromSeq !== undefined || toSeq !== undefined) {
      filter.seq = {};
      if (fromSeq !== undefined) (filter.seq as any).$gte = fromSeq;
      if (toSeq !== undefined) (filter.seq as any).$lte = toSeq;
    }
    return this.events.find(filter).sort({ seq: 1 }).toArray();
  }

  /** Detects duplicate events (by matchId + seq) */
  async isDuplicate(matchId: string, seq: number): Promise<boolean> {
    const existing = await this.events.findOne({ matchId, seq });
    return existing !== null;
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
  async getEventsByType(type: string, limit: number = 100): Promise<StoredEvent[]> {
    return this.events.find({ type }).sort({ serverTs: -1 }).limit(limit).toArray();
  }
}
