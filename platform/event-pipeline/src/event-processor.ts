import { CanonicalEvent } from '@adaptive-ai/sdk-protocol';
import { EventStore } from './event-store';
import { validateBatch, validateSequencing } from './validation';
import { EventBatchResult } from './types';
import { EventPipelineConfig } from './config';
import { Logger } from './logger';
import { MetricsRegistry } from './metrics';
import { v4 as uuidv4 } from 'uuid';

/** Processes a batch of events through the pipeline: validate, dedupe, order, persist. */
export class EventProcessor {
  constructor(
    private store: EventStore,
    private config: EventPipelineConfig,
    private logger: Logger = new Logger(),
    private metrics: MetricsRegistry = new MetricsRegistry()
  ) {}

  /**
   * Full pipeline processing:
   * 1. Validate batch structure and events
   * 2. Validate sequencing (detect gaps, out-of-order) against last known seq
   * 3. Batch-check duplicates (one query, not one per event)
   * 4. Persist all newly-accepted events atomically
   * 5. Return a detailed, per-event result
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
    const log = this.logger.child({ batchId, matchId });

    // Step 1: Validate batch structure and per-event schema
    const validation = validateBatch(batchData, this.config.maxBatchSize);
    if (!validation.valid) {
      this.metrics.batchesReceived.inc({ outcome: 'validation_error' });
      this.metrics.validationFailures.inc({}, validation.errors.length);
      log.warn('Batch rejected: validation failed', { errorCount: validation.errors.length });
      return {
        batchId,
        matchId,
        eventCount: 0,
        accepted: 0,
        rejected: 0,
        errors: validation.errors.map((error, index) => ({ index, seq: 0, error })),
      };
    }

    const rawEvents = validation.events;

    // Step 2: Sequence validation against what's already persisted for this match
    const lastSeq = await this.store.getLastSequence(matchId);
    const sequenceValidation = validateSequencing(rawEvents, lastSeq);
    if (!sequenceValidation.valid) {
      this.metrics.batchesReceived.inc({ outcome: 'sequence_error' });
      log.warn('Batch rejected: sequence validation failed', { error: sequenceValidation.error });
      return {
        batchId,
        matchId,
        eventCount: rawEvents.length,
        accepted: 0,
        rejected: rawEvents.length,
        errors: [{ index: 0, seq: rawEvents[0]?.seq || 0, error: sequenceValidation.error }],
      };
    }

    if (sequenceValidation.gaps.length > 0) {
      log.warn('Sequence gap detected — missing events for this match', {
        gapCount: sequenceValidation.gaps.length,
        gaps: sequenceValidation.gaps.slice(0, 20), // cap log payload
      });
    }
    if (sequenceValidation.outOfOrder) {
      log.warn('Batch contains internally out-of-order events');
    }

    // Step 3: Batch duplicate lookup — one query covering every seq in this batch
    const existingSeqs = await this.store.getExistingSeqs(
      matchId,
      rawEvents.map((e) => e.seq)
    );

    const errors: Array<{ index: number; seq: number; field: string; error: string }> = [];
    const eventsToStore: Array<{ event: CanonicalEvent; validationStatus: 'valid' | 'warning'; sourcePlugin: string }> = [];
    let accepted = 0;
    let rejected = 0;

    for (let i = 0; i < rawEvents.length; i++) {
      const raw = rawEvents[i];

      if (existingSeqs.has(raw.seq)) {
        this.metrics.duplicateEvents.inc();
        errors.push({ index: i, seq: raw.seq, field: 'seq', error: 'Duplicate event sequence number' });
        rejected++;
        continue;
      }

      const isOutOfOrder = raw.seq <= lastSeq;
      if (isOutOfOrder) this.metrics.outOfOrderEvents.inc();
      const status = isOutOfOrder && raw.seq > lastSeq - this.config.deduplicationWindow ? ('warning' as const) : ('valid' as const);

      const event: CanonicalEvent = {
        matchId,
        playerId,
        gameId,
        seq: raw.seq,
        ts: raw.ts || Date.now(),
        type: raw.type as CanonicalEvent['type'],
        payload: raw.payload,
        schemaVersion,
      };

      eventsToStore.push({ event, validationStatus: status, sourcePlugin: 'plugin-adapter-v1' });
      accepted++;
    }

    // Step 4: Persist atomically
    if (eventsToStore.length > 0) {
      const storageStart = Date.now();
      await this.store.storeEvents(eventsToStore);
      this.metrics.storageLatencyMs.observe(Date.now() - storageStart);
      await this.store.recordBatch(batchId, matchId, playerId, eventsToStore.length, Date.now() - startTime);
    }

    this.metrics.eventsProcessed.inc({ outcome: 'accepted' }, accepted);
    this.metrics.eventsProcessed.inc({ outcome: 'rejected' }, rejected);
    this.metrics.batchesReceived.inc({ outcome: rejected === rawEvents.length && rawEvents.length > 0 ? 'all_rejected' : 'accepted' });
    this.metrics.batchLatencyMs.observe(Date.now() - startTime);

    log.info('Batch processed', { eventCount: rawEvents.length, accepted, rejected, durationMs: Date.now() - startTime });

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
