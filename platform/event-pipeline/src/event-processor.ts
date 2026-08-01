import { CanonicalEvent } from '@adaptive-ai/sdk-protocol';
import { EventStore } from './event-store';
import { validateBatch, validateSequencing } from './validation';
import { EventBatchResult } from './types';
import { v4 as uuidv4 } from 'uuid';

/** Processes a batch of events through the pipeline */
export class EventProcessor {
  private maxBatchSize: number;
  private deduplicationWindow: number; // in events, for memory management

  constructor(private store: EventStore, maxBatchSize: number = 1000, deduplicationWindow: number = 10000) {
    this.maxBatchSize = maxBatchSize;
    this.deduplicationWindow = deduplicationWindow;
  }

  /**
   * Full pipeline processing:
   * 1. Validate batch structure and events
   * 2. Check for duplicates
   * 3. Validate sequencing (detect gaps, out-of-order)
   * 4. Persist events
   * 5. Return detailed result
   */
  async processBatch(
    batchData: unknown,
    matchId: string,
    playerId: string,
    gameId: string,
    schemaVersion: string
  ): Promise<EventBatchResult> {
    const batchId = `batch-${uuidv4()}`;
    const startTime = Date.now();
    const errors: Array<{ index: number; seq: number; field: string; error: string }> = [];
    let accepted = 0;
    let rejected = 0;

    // Step 1: Validate batch structure
    const validation = validateBatch(batchData, this.maxBatchSize);
    if (!validation.valid) {
      return {
        batchId,
        matchId,
        eventCount: 0,
        accepted: 0,
        rejected: 0,
        errors: validation.errors.map((error, index) => ({
          index,
          seq: 0,
          error,
        })),
      };
    }

    const rawEvents = validation.events;

    // Step 2: Get last sequence for duplicate/ordering checks
    const lastSeq = await this.store.getLastSequence(matchId);

    // Step 3: Validate sequencing
    const sequenceValidation = validateSequencing(rawEvents, lastSeq);
    if (!sequenceValidation.valid) {
      return {
        batchId,
        matchId,
        eventCount: rawEvents.length,
        accepted: 0,
        rejected: rawEvents.length,
        errors: [
          {
            index: 0,
            seq: rawEvents[0]?.seq || 0,
            error: sequenceValidation.error,
          },
        ],
      };
    }

    // Step 4: Check each event for duplicates and prepare for storage
    const eventsToStore: Array<{
      event: CanonicalEvent;
      validationStatus: 'valid' | 'warning';
      sourcePlugin: string;
    }> = [];

    for (let i = 0; i < rawEvents.length; i++) {
      const raw = rawEvents[i];
      const isDuplicate = await this.store.isDuplicate(matchId, raw.seq);

      if (isDuplicate) {
        errors.push({
          index: i,
          seq: raw.seq,
          field: 'seq',
          error: 'Duplicate event sequence number',
        });
        rejected++;
        continue;
      }

      // Check for out-of-order (warning, not error)
      const isOutOfOrder = raw.seq <= lastSeq;
      const status = isOutOfOrder && raw.seq > lastSeq - this.deduplicationWindow ? ('warning' as const) : ('valid' as const);

      const event: CanonicalEvent = {
        matchId,
        playerId,
        gameId,
        seq: raw.seq,
        ts: raw.ts || Date.now(),
        type: raw.type as any,
        payload: raw.payload,
        schemaVersion,
      };

      eventsToStore.push({
        event,
        validationStatus: status,
        sourcePlugin: 'plugin-adapter-v1',
      });
      accepted++;
    }

    // Step 5: Store all accepted events atomically
    if (eventsToStore.length > 0) {
      await this.store.storeEvents(eventsToStore);
      await this.store.recordBatch(batchId, matchId, playerId, eventsToStore.length, Date.now() - startTime);
    }

    return {
      batchId,
      matchId,
      eventCount: rawEvents.length,
      accepted,
      rejected,
      errors,
    };
  }
}
