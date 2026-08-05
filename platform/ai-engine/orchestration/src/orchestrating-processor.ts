/**
 * OrchestratingEventProcessor — the seam where raw event ingestion becomes
 * automatic AI analysis, with NO manual trigger required.
 *
 * Implements @adaptive-ai/event-pipeline's `EventBatchProcessor` interface,
 * so it drops into `createEventPipelineRouter({ processor, ... })` in place
 * of a plain `EventProcessor` — every existing route (auth, rate limiting,
 * validation, storage, replay) keeps working completely unchanged. This
 * class only ever wraps the real EventProcessor; it never reimplements
 * validation, dedup, or persistence.
 *
 * After the inner EventProcessor accepts a batch:
 *   1. Every accepted event is reconstructed (from the same validated batch
 *      payload the inner processor already parsed — no extra DB round trip)
 *      and fed into MatchOrchestrator.ingestEvent(), in order.
 *   2. If a MatchEnded event is present in the batch, MatchOrchestrator
 *      .completeMatch() runs automatically once every event in the batch
 *      has been ingested — the full Memory Engine -> Player Modeling ->
 *      Pattern Recognition workflow, with no caller action required.
 *   3. The resulting MatchProcessingReport (if any) is attached to the HTTP
 *      response body under `orchestration`, so a plugin's final batch
 *      submission gets back its own updated profile summary synchronously,
 *      IN ADDITION to being durably persisted (ReportStore) and published
 *      (MatchOrchestrator's 'match:completed' event) for any other listener.
 */

import { CanonicalEvent } from '@adaptive-ai/sdk-protocol';
import { EventBatchProcessor, EventBatchResult } from '@adaptive-ai/event-pipeline';
import { MatchOrchestrator } from './match-orchestrator';
import { Logger, rootLogger } from './logger';
import { MatchProcessingReport } from './types';

export interface OrchestratedEventBatchResult extends EventBatchResult {
  /** Present only when this batch's events included MatchEnded and orchestration ran. */
  orchestration?: MatchProcessingReport;
}

export class OrchestratingEventProcessor implements EventBatchProcessor {
  private readonly logger: Logger;

  constructor(
    private readonly inner: EventBatchProcessor,
    private readonly orchestrator: MatchOrchestrator,
    logger?: Logger
  ) {
    this.logger = (logger ?? rootLogger).child({ component: 'orchestrating-processor' });
  }

  async processBatch(batchData: unknown, matchId: string, playerId: string, gameId: string, schemaVersion: string): Promise<OrchestratedEventBatchResult> {
    const result = await this.inner.processBatch(batchData, matchId, playerId, gameId, schemaVersion);

    if (result.accepted === 0) {
      return result;
    }

    // The inner processor only reaches a non-zero `accepted` count once
    // every event in `batchData.events` has individually passed schema
    // validation (validateBatch is all-or-nothing on schema errors — see
    // @adaptive-ai/event-pipeline's validation.ts), so `batchData.events`
    // and the processor's internal `rawEvents` share the same order/length.
    // Only per-event duplicate/out-of-order rejections (reported in
    // `result.errors`, keyed by that same index) are excluded below.
    const rawEvents = extractRawEvents(batchData);
    const rejectedIndices = new Set(result.errors.map((e) => e.index));

    const acceptedEvents: CanonicalEvent[] = [];
    for (let i = 0; i < rawEvents.length; i++) {
      if (rejectedIndices.has(i)) continue;
      const raw = rawEvents[i];
      acceptedEvents.push({
        matchId,
        playerId,
        gameId,
        seq: raw.seq,
        ts: raw.ts ?? Date.now(),
        type: raw.type as CanonicalEvent['type'],
        payload: raw.payload,
        schemaVersion,
      });
    }

    // Ingest in seq order — mirrors the guarantee EventProcessor itself
    // provides for storage, so Memory Engine's recentEvents accumulate in
    // the same order they'll be replayed in later.
    acceptedEvents.sort((a, b) => a.seq - b.seq);

    let matchEnded = false;
    for (const event of acceptedEvents) {
      try {
        this.orchestrator.ingestEvent(event);
      } catch (err) {
        // An ingest failure for one event (e.g. the match was already
        // completed by a racing/duplicate MatchEnded) must never abort
        // storage of the rest of the batch — the events are already
        // durably persisted by the inner processor at this point. Log and
        // continue; this event simply never reaches Working/Short-Term
        // Memory, an outcome already visible in the report as "fewer
        // events than expected" rather than a silent corruption.
        this.logger.warn('Failed to ingest event into orchestrator — event remains persisted, memory unaffected', {
          matchId,
          seq: event.seq,
          type: event.type,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      if (event.type === 'MatchEnded') matchEnded = true;
    }

    if (!matchEnded) {
      return result;
    }

    try {
      const report = await this.orchestrator.completeMatch(matchId);
      return { ...result, orchestration: report };
    } catch (err) {
      // completeMatch() is fatal only for the memory-commit stage itself
      // (see MatchOrchestrator's doc comment) — if even that fails, the
      // batch's events are still safely stored by the inner processor;
      // only the derived-intelligence workflow did not run. Surface this
      // clearly in the log; the caller can retry completion out-of-band
      // via the orchestrator directly since the events are not lost.
      this.logger.error('Match completion failed — events remain persisted, orchestration did not run', {
        matchId,
        error: err instanceof Error ? err.message : String(err),
      });
      return result;
    }
  }
}

interface RawEventLike {
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  ts?: number;
}

/** Mirrors @adaptive-ai/event-pipeline's own validateBatch() event-shape extraction, applied to the same already-validated request body. */
function extractRawEvents(batchData: unknown): RawEventLike[] {
  if (!batchData || typeof batchData !== 'object') return [];
  const events = (batchData as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];
  return events as RawEventLike[];
}
