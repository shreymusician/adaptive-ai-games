/**
 * Validation plugins — Phase 3.5 platform validation.
 *
 * These are NOT real playable games. Each one is a deterministic generator
 * of the exact wire shape a real plugin's Host SDK would produce after
 * stamping match context (see sdk/protocol/src/types.ts EmitEventInput),
 * i.e. `{ type, payload, ts?, seq }` batches ready for POST /api/events/batch.
 *
 * Driving the pipeline through this shape (rather than calling
 * EventProcessor directly) exercises the same contract a real plugin
 * crosses: SDK emit -> host stamping -> HTTP batch -> validation ->
 * persistence -> replay. Iframe/postMessage transport itself is validated
 * separately by the existing sdk/host test suite (jsdom-based); Node has no
 * browser DOM, so simulating that hop here would test jsdom, not the
 * pipeline.
 */

export interface RawEvent {
  type: string;
  payload: Record<string, unknown>;
  ts?: number;
  seq: number;
}

export interface PluginScenario {
  name: string;
  description: string;
  /** One array per HTTP batch submission, in the order they should be sent. */
  batches: RawEvent[][];
}

// ---------------------------------------------------------------------------
// 1. Simple Dummy Game — canonical happy path
// ---------------------------------------------------------------------------
export function dummyGameScenario(): PluginScenario {
  const now = Date.now();
  let seq = 0;
  const next = (): number => ++seq;

  const batch1: RawEvent[] = [
    { type: 'MatchStarted', payload: { map: 'arena-1' }, seq: next(), ts: now },
    { type: 'PlayerMoved', payload: { x: 0, y: 0 }, seq: next(), ts: now + 100 },
    { type: 'PlayerMoved', payload: { x: 1, y: 0 }, seq: next(), ts: now + 200 },
    { type: 'TargetAcquired', payload: { targetId: 'bot-1' }, seq: next(), ts: now + 300 },
    { type: 'AbilityUsed', payload: { abilityId: 'slash' }, seq: next(), ts: now + 400 },
    { type: 'PlayerDamaged', payload: { amount: 12, sourceId: 'bot-1' }, seq: next(), ts: now + 450 },
  ];
  const batch2: RawEvent[] = [
    { type: 'DecisionPoint', payload: { options: ['attack', 'retreat'] }, seq: next(), ts: now + 500 },
    { type: 'AbilityUsed', payload: { abilityId: 'slash' }, seq: next(), ts: now + 600 },
    { type: 'PlayerDied', payload: { killerId: 'p1' }, seq: next(), ts: now + 650 },
    { type: 'MatchEnded', payload: { outcome: 'win', winnerId: 'p1' }, seq: next(), ts: now + 700 },
  ];

  return {
    name: 'dummy-game',
    description: 'Simple canonical game: movement, damage, match start/end, legal actions',
    batches: [batch1, batch2],
  };
}

// ---------------------------------------------------------------------------
// 2. Fast Action Game — high-frequency movement, large batches, stress shape
// ---------------------------------------------------------------------------
export function fastActionScenario(opts: { batchCount?: number; eventsPerBatch?: number } = {}): PluginScenario {
  const batchCount = opts.batchCount ?? 20;
  const eventsPerBatch = opts.eventsPerBatch ?? 50; // 1000 events total by default
  const now = Date.now();
  let seq = 0;

  const batches: RawEvent[][] = [];
  batches.push([{ type: 'MatchStarted', payload: { map: 'speedway' }, seq: ++seq, ts: now }]);

  for (let b = 0; b < batchCount; b++) {
    const batch: RawEvent[] = [];
    for (let i = 0; i < eventsPerBatch; i++) {
      const t = now + (b * eventsPerBatch + i) * 16; // ~60fps cadence
      batch.push({
        type: i % 7 === 0 ? 'AbilityUsed' : 'PlayerMoved',
        payload: i % 7 === 0 ? { abilityId: 'dash' } : { x: Math.sin(i), y: Math.cos(i), vx: 1, vy: 0 },
        seq: ++seq,
        ts: t,
      });
    }
    batches.push(batch);
  }

  batches.push([{ type: 'MatchEnded', payload: { outcome: 'timeout' }, seq: ++seq, ts: now + batchCount * eventsPerBatch * 16 + 100 }]);
  return {
    name: 'fast-action-game',
    description: `High-frequency movement: ${batchCount} batches x ${eventsPerBatch} events (${seq} total)`,
    batches,
  };
}

// ---------------------------------------------------------------------------
// 3. Edge Case Plugin — deliberately hostile / malformed inputs.
//    Each scenario below is submitted independently; the harness asserts the
//    specific rejection behavior for each rather than treating this as one
//    linear match. `expect` documents the required outcome for the report.
// ---------------------------------------------------------------------------
export interface EdgeCase {
  name: string;
  body: unknown;
  expect: string;
}

export function edgeCasePlugin(): EdgeCase[] {
  const now = Date.now();
  return [
    {
      name: 'malformed-event-missing-payload',
      body: { events: [{ type: 'PlayerMoved', seq: 1 }] },
      expect: 'rejected: payload must be a non-array object',
    },
    {
      name: 'malformed-event-non-canonical-type',
      body: { events: [{ type: 'TotallyMadeUpEvent', payload: {}, seq: 1 }] },
      expect: 'rejected: type is not canonical',
    },
    {
      name: 'malformed-event-negative-seq',
      body: { events: [{ type: 'PlayerMoved', payload: {}, seq: -1 }] },
      expect: 'rejected: seq must be a positive integer',
    },
    {
      name: 'malformed-event-array-payload',
      body: { events: [{ type: 'PlayerMoved', payload: [1, 2, 3], seq: 1 }] },
      expect: 'rejected: payload must be a non-array object',
    },
    {
      name: 'duplicate-seq-within-batch',
      body: {
        events: [
          { type: 'PlayerMoved', payload: {}, seq: 1 },
          { type: 'PlayerMoved', payload: {}, seq: 1 },
        ],
      },
      expect: 'second occurrence rejected as duplicate once first is persisted',
    },
    {
      name: 'missing-sequence-numbers-gap',
      body: { events: [{ type: 'PlayerMoved', payload: {}, seq: 50 }] },
      expect: 'accepted but flagged: sequence gap detected (1..49 missing) and logged',
    },
    {
      name: 'out-of-order-events',
      body: {
        events: [
          { type: 'PlayerMoved', payload: {}, seq: 5 },
          { type: 'PlayerMoved', payload: {}, seq: 3 },
          { type: 'PlayerMoved', payload: {}, seq: 4 },
        ],
      },
      expect: 'rejected: internally out-of-order batch fails validateSequencing',
    },
    {
      name: 'oversized-event-payload',
      body: { events: [{ type: 'PlayerMoved', payload: { blob: 'x'.repeat(20 * 1024) }, seq: 1 }] },
      expect: 'rejected (400): per-event payload exceeds the 10KB event-level limit (validation layer)',
    },
    {
      name: 'oversized-request-body',
      body: { events: [{ type: 'PlayerMoved', payload: { blob: 'x'.repeat(80 * 1024) }, seq: 1 }] },
      expect: 'rejected (413): whole request body exceeds configured maxBatchPayloadBytes (body-parser layer)',
    },
    {
      // Count (1001) deliberately kept just over the configured maxBatchSize
      // (1000) while total body bytes stay well under maxBatchPayloadBytes,
      // so this specifically exercises the event-count limit rather than
      // tripping the body-size limit first (see 'oversized-request-body').
      name: 'oversized-batch',
      body: { events: Array.from({ length: 1001 }, (_, i) => ({ type: 'PlayerMoved', payload: {}, seq: i + 1 })) },
      expect: 'rejected (400): batch size exceeds configured maxBatchSize',
    },
    {
      name: 'empty-batch',
      body: { events: [] },
      expect: 'rejected: events array must not be empty',
    },
    {
      name: 'future-timestamp',
      body: { events: [{ type: 'PlayerMoved', payload: {}, seq: 1, ts: now + 10 * 60 * 1000 }] },
      expect: 'rejected: ts more than 60s in the future',
    },
    {
      name: 'ancient-timestamp',
      body: { events: [{ type: 'PlayerMoved', payload: {}, seq: 1, ts: now - 48 * 60 * 60 * 1000 }] },
      expect: 'accepted with warning: ts more than 24h old',
    },
    {
      name: 'non-object-body',
      body: 'not-json-object',
      expect: 'rejected: request body must be an object',
    },
    {
      name: 'events-not-array',
      body: { events: 'nope' },
      expect: 'rejected: events must be an array',
    },
    {
      name: 'spoofed-match-identity-in-body',
      body: { matchId: 'someone-elses-match', playerId: 'admin', events: [{ type: 'PlayerMoved', payload: {}, seq: 1 }] },
      expect: 'ignored: identity is derived from the bearer token only',
    },
  ];
}

/** SDK/version-negotiation edge cases — asserted against sdk/protocol directly, not HTTP. */
export function versionMismatchCases(): Array<{ client: string; host: string; expectCompatible: boolean }> {
  return [
    { client: '0.1.0', host: '0.1.0', expectCompatible: true },
    { client: '0.1.5', host: '0.1.0', expectCompatible: true }, // patch drift OK
    { client: '0.2.0', host: '0.1.0', expectCompatible: false }, // minor mismatch
    { client: '1.0.0', host: '0.1.0', expectCompatible: false }, // major mismatch
    { client: 'garbage', host: '0.1.0', expectCompatible: false },
  ];
}
