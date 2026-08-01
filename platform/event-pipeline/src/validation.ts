import { CanonicalEventType, isCanonicalEventType, isAction } from '@adaptive-ai/sdk-protocol';
import { ValidationError } from './types';

const MAX_PAYLOAD_SIZE = 10 * 1024; // 10KB per event
const MAX_TIMESTAMP_OFFSET = 60 * 1000; // 1 minute from now
const MIN_TIMESTAMP_OFFSET = 24 * 60 * 60 * 1000; // 24 hours ago

/** Validates a single event from a batch */
export function validateEvent(
  event: unknown,
  index: number,
  schemaVersion: string,
  now: number = Date.now()
): { valid: true; warnings: string[] } | { valid: false; error: string } {
  if (!event || typeof event !== 'object') {
    return { valid: false, error: 'Event must be an object' };
  }

  const e = event as Record<string, unknown>;

  // Validate seq (required, must be positive integer)
  if (typeof e.seq !== 'number' || !Number.isInteger(e.seq) || e.seq < 1) {
    return { valid: false, error: 'seq must be a positive integer' };
  }

  // Validate type (required, must be canonical)
  if (!isCanonicalEventType(e.type)) {
    return { valid: false, error: `type "${e.type}" is not a canonical event type` };
  }

  // Validate payload (required, must be object)
  if (!e.payload || typeof e.payload !== 'object' || Array.isArray(e.payload)) {
    return { valid: false, error: 'payload must be a non-array object' };
  }

  // Validate payload size
  const payloadJson = JSON.stringify(e.payload);
  if (payloadJson.length > MAX_PAYLOAD_SIZE) {
    return { valid: false, error: `payload exceeds ${MAX_PAYLOAD_SIZE} bytes` };
  }

  // Validate timestamp (optional, defaults to now)
  const warnings: string[] = [];
  let ts = e.ts as number | undefined;
  if (ts !== undefined) {
    if (typeof ts !== 'number' || !Number.isFinite(ts)) {
      return { valid: false, error: 'ts must be a valid number' };
    }
    if (ts > now + MAX_TIMESTAMP_OFFSET) {
      return { valid: false, error: `ts is more than ${MAX_TIMESTAMP_OFFSET}ms in the future` };
    }
    if (ts < now - MIN_TIMESTAMP_OFFSET) {
      warnings.push(`ts is more than 24 hours old`);
    }
  }

  return { valid: true, warnings };
}

/** Validates an entire batch request */
export function validateBatch(
  body: unknown,
  maxBatchSize: number = 1000
): { valid: true; events: Array<{ seq: number; type: string; payload: Record<string, unknown>; ts?: number }> } | { valid: false; errors: string[] } {
  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be an object'] };
  }

  const b = body as Record<string, unknown>;

  // Validate events array
  if (!Array.isArray(b.events)) {
    return { valid: false, errors: ['events must be an array'] };
  }

  if (b.events.length === 0) {
    return { valid: false, errors: ['events array must not be empty'] };
  }

  if (b.events.length > maxBatchSize) {
    return { valid: false, errors: [`batch size exceeds ${maxBatchSize}`] };
  }

  // Validate each event
  const errors: string[] = [];
  const validEvents: Array<{ seq: number; type: string; payload: Record<string, unknown>; ts?: number }> = [];

  for (let i = 0; i < b.events.length; i++) {
    const result = validateEvent(b.events[i], i, '1');
    if (!result.valid) {
      errors.push(`Event ${i}: ${result.error}`);
    } else {
      const evt = b.events[i] as any;
      validEvents.push({
        seq: evt.seq,
        type: evt.type,
        payload: evt.payload,
        ts: evt.ts,
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, events: validEvents };
}

/** Validates sequence numbers in a batch */
export function validateSequencing(
  events: Array<{ seq: number }>,
  lastSeq: number
): { valid: true; gaps: number[]; outOfOrder: boolean } | { valid: false; error: string } {
  if (events.length === 0) {
    return { valid: true, gaps: [], outOfOrder: false };
  }

  const seqs = events.map((e) => e.seq);
  const gaps: number[] = [];
  let outOfOrder = false;

  // Check for out-of-order
  for (let i = 1; i < seqs.length; i++) {
    if (seqs[i] < seqs[i - 1]) {
      outOfOrder = true;
    }
  }

  // Check for gaps (if first event > lastSeq + 1, there's a gap)
  if (seqs[0] > lastSeq + 1) {
    for (let i = lastSeq + 1; i < seqs[0]; i++) {
      gaps.push(i);
    }
  }

  // Check for gaps within the batch
  for (let i = 1; i < seqs.length; i++) {
    if (seqs[i] > seqs[i - 1] + 1) {
      for (let j = seqs[i - 1] + 1; j < seqs[i]; j++) {
        gaps.push(j);
      }
    }
  }

  return { valid: true, gaps, outOfOrder };
}
