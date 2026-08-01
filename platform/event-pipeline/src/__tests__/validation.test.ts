import { describe, it, expect } from 'vitest';
import { validateEvent, validateBatch, validateSequencing } from '../validation';

describe('validateEvent', () => {
  it('accepts a valid event', () => {
    const event = {
      type: 'PlayerMoved',
      payload: { x: 10, y: 20 },
      seq: 1,
      ts: Date.now(),
    };
    const result = validateEvent(event);
    expect(result.valid).toBe(true);
  });

  it('rejects invalid event type', () => {
    const event = {
      type: 'InvalidType',
      payload: {},
      seq: 1,
    };
    const result = validateEvent(event);
    expect(result.valid).toBe(false);
  });

  it('rejects missing seq', () => {
    const event = {
      type: 'PlayerMoved',
      payload: {},
    };
    const result = validateEvent(event);
    expect(result.valid).toBe(false);
  });

  it('rejects non-integer seq', () => {
    const event = {
      type: 'PlayerMoved',
      payload: {},
      seq: 1.5,
    };
    const result = validateEvent(event);
    expect(result.valid).toBe(false);
  });

  it('rejects negative seq', () => {
    const event = {
      type: 'PlayerMoved',
      payload: {},
      seq: -1,
    };
    const result = validateEvent(event);
    expect(result.valid).toBe(false);
  });

  it('rejects oversized payload', () => {
    const event = {
      type: 'PlayerMoved',
      payload: { data: 'x'.repeat(15 * 1024) },
      seq: 1,
    };
    const result = validateEvent(event);
    expect(result.valid).toBe(false);
  });

  it('rejects timestamp in far future', () => {
    const event = {
      type: 'PlayerMoved',
      payload: {},
      seq: 1,
      ts: Date.now() + 2 * 60 * 1000,
    };
    const result = validateEvent(event);
    expect(result.valid).toBe(false);
  });

  it('warns on very old timestamp', () => {
    const event = {
      type: 'PlayerMoved',
      payload: {},
      seq: 1,
      ts: Date.now() - 48 * 60 * 60 * 1000,
    };
    const result = validateEvent(event);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });
});

describe('validateBatch', () => {
  it('accepts a valid batch', () => {
    const batch = {
      events: [
        { type: 'PlayerMoved', payload: { x: 10 }, seq: 1 },
        { type: 'PlayerDamaged', payload: { damage: 5 }, seq: 2 },
      ],
    };
    const result = validateBatch(batch);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.events).toHaveLength(2);
    }
  });

  it('rejects empty batch', () => {
    const batch = { events: [] };
    const result = validateBatch(batch);
    expect(result.valid).toBe(false);
  });

  it('rejects batch exceeding size limit', () => {
    const batch = {
      events: Array(1001)
        .fill(null)
        .map((_, i) => ({ type: 'PlayerMoved', payload: {}, seq: i + 1 })),
    };
    const result = validateBatch(batch, 1000);
    expect(result.valid).toBe(false);
  });

  it('rejects non-array events', () => {
    const batch = { events: 'not an array' };
    const result = validateBatch(batch);
    expect(result.valid).toBe(false);
  });

  it('reports per-event errors', () => {
    const batch = {
      events: [
        { type: 'PlayerMoved', payload: {}, seq: 1 },
        { type: 'Invalid', payload: {}, seq: 2 },
        { type: 'PlayerDamaged', payload: {}, seq: 'not-a-number' },
      ],
    };
    const result = validateBatch(batch);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBe(2);
    }
  });
});

describe('validateSequencing', () => {
  it('accepts sequential events', () => {
    const events = [{ seq: 1 }, { seq: 2 }, { seq: 3 }];
    const result = validateSequencing(events, 0);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.gaps).toHaveLength(0);
      expect(result.outOfOrder).toBe(false);
    }
  });

  it('detects out-of-order events', () => {
    const events = [{ seq: 2 }, { seq: 1 }, { seq: 3 }];
    const result = validateSequencing(events, 0);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.outOfOrder).toBe(true);
    }
  });

  it('detects gaps between batches', () => {
    const events = [{ seq: 5 }, { seq: 6 }];
    const result = validateSequencing(events, 2);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.gaps).toContain(3);
      expect(result.gaps).toContain(4);
    }
  });

  it('detects gaps within batch', () => {
    const events = [{ seq: 1 }, { seq: 3 }, { seq: 4 }];
    const result = validateSequencing(events, 0);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.gaps).toContain(2);
    }
  });
});
