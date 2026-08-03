/**
 * The standard analyzer interface every behavioral dimension implements.
 * ADAPTIVE_AI_ENGINE_WHITEPAPER.md §3 — every dimension is an independent,
 * isolated analyzer; the registry (see registry.ts) executes them without
 * knowing their implementation details.
 *
 * Lifecycle, called once per (player, match) run, in this exact order:
 *   metadata()      — static descriptor, may be read at any time
 *   initialize(ctx) — reset internal accumulator, capture the run context
 *   consumeEvent()  — called once per raw event in the match's event log
 *   consumeMatch()  — called once, after every event, with match-level context
 *   calculate()     — pure: derive this match's observation(s) from the accumulator
 *   confidence()    — pure: how much to trust calculate()'s result (the per-match evidence gate)
 *   update()        — pure: fold one observation into a prior (value, confidence, samples) via the shared EWMA primitive
 *   reset()         — clear the accumulator so the SAME instance can be reused for the next run (pooling — see README "Performance")
 */

import { applyObservation } from '@adaptive-ai/memory-engine';
import { AnalyzerRunContext, DimensionAnalyzerMetadata, DimensionAnalyzerResult, DimensionSnapshotInput, ShortTermEventRef } from './types';

export interface DimensionAnalyzer {
  readonly metadata: DimensionAnalyzerMetadata;

  initialize(ctx: AnalyzerRunContext): void;
  consumeEvent(event: ShortTermEventRef, ctx: AnalyzerRunContext): void;
  consumeMatch(ctx: AnalyzerRunContext): void;
  calculate(): DimensionAnalyzerResult;
  confidence(): number;
  /** Applies the whitepaper §3.1 EWMA primitive. `k`/`alphaMin` are supplied by the caller (PlayerModelingConfig), not hardcoded per analyzer. */
  update(prior: DimensionSnapshotInput, observation: number, k: number, alphaMin: number): DimensionSnapshotInput;
  reset(): void;
}

export type DimensionAnalyzerFactory = () => DimensionAnalyzer;

/**
 * Shared plumbing for continuous (single-scalar) dimensions: context
 * capture, the EWMA `update()` implementation (delegating to Memory
 * Engine's `applyObservation` — never reimplemented), and a memoized
 * `confidence()` read from the last `calculate()`. Subclasses implement only
 * `consumeEvent`/`consumeMatch`/`deriveResult` — the actual behavioral
 * signal — keeping each dimension's file small and self-contained.
 *
 * This is a shared BASE CLASS, not a shared PlayerModel god-object: each
 * subclass instance still owns only its own dimension's accumulator, is
 * registered independently, and can be added/removed without touching any
 * other analyzer (whitepaper's "no giant PlayerModel class" requirement is
 * about state and responsibility isolation, not about forbidding DRY
 * boilerplate).
 */
export abstract class BaseDimensionAnalyzer implements DimensionAnalyzer {
  protected ctx!: AnalyzerRunContext;
  private lastResult: DimensionAnalyzerResult | null = null;

  abstract readonly metadata: DimensionAnalyzerMetadata;

  initialize(ctx: AnalyzerRunContext): void {
    this.ctx = ctx;
    this.resetAccumulator();
    this.lastResult = null;
  }

  abstract consumeEvent(event: ShortTermEventRef, ctx: AnalyzerRunContext): void;
  abstract consumeMatch(ctx: AnalyzerRunContext): void;

  /** Subclasses derive this match's observation(s) purely from accumulated state — no I/O, no historical recomputation. */
  protected abstract deriveResult(): DimensionAnalyzerResult;

  /** Subclasses clear whatever internal counters they keep. Called by both initialize() and reset(). */
  protected abstract resetAccumulator(): void;

  calculate(): DimensionAnalyzerResult {
    this.lastResult = this.deriveResult();
    return this.lastResult;
  }

  confidence(): number {
    return this.lastResult?.matchConfidence ?? 0;
  }

  update(prior: DimensionSnapshotInput, observation: number, k: number, alphaMin: number): DimensionSnapshotInput {
    return applyObservation(prior, observation, k, alphaMin);
  }

  reset(): void {
    this.resetAccumulator();
    this.lastResult = null;
  }
}

/**
 * Shared plumbing for categorical dimensions (whitepaper §3.3: "favorites"
 * use the identical EWMA machinery over a frequency table rather than a
 * scalar"). Each category is persisted as its own scalar dimension key
 * (`${id}:${category}`), observed as that category's SHARE of this match's
 * qualifying events — the consumer's `argmax` over the resulting per-key
 * EWMA values recovers the "favorite", exactly as the whitepaper specifies.
 */
export abstract class BaseCategoricalAnalyzer implements DimensionAnalyzer {
  protected ctx!: AnalyzerRunContext;
  protected counts: Map<string, number> = new Map();
  private lastResult: DimensionAnalyzerResult | null = null;

  abstract readonly metadata: DimensionAnalyzerMetadata;

  initialize(ctx: AnalyzerRunContext): void {
    this.ctx = ctx;
    this.counts = new Map();
    this.lastResult = null;
  }

  abstract consumeEvent(event: ShortTermEventRef, ctx: AnalyzerRunContext): void;

  consumeMatch(_ctx: AnalyzerRunContext): void {
    // Categorical dimensions in this phase derive entirely from per-event
    // counting; subclasses may override for match-level adjustments.
  }

  protected tally(category: string, delta: number = 1): void {
    this.counts.set(category, (this.counts.get(category) ?? 0) + delta);
  }

  calculate(): DimensionAnalyzerResult {
    const total = [...this.counts.values()].reduce((a, b) => a + b, 0);
    if (total === 0) {
      this.lastResult = { entries: [], matchConfidence: 0, metadata: { totalObservations: 0 } };
      return this.lastResult;
    }
    const entries = [...this.counts.entries()].map(([category, count]) => ({
      key: `${this.metadata.id}:${category}`,
      observation: count / total,
      sampleCount: count,
    }));
    // Concentration-based match confidence: a sharply peaked table this
    // match is a stronger signal than a flat one, in addition to raw volume
    // — reuses the same "peaked vs uniform" intuition as the whitepaper's
    // pattern-promotion gate (§5.2), scaled by sample volume via the shared
    // asymptotic form so a single lucky category from 2 events isn't
    // over-trusted.
    const maxShare = Math.max(...entries.map((e) => e.observation));
    const volumeFactor = 1 - Math.exp(-total / 5);
    this.lastResult = { entries, matchConfidence: maxShare * volumeFactor, metadata: { totalObservations: total, categories: entries.length } };
    return this.lastResult;
  }

  confidence(): number {
    return this.lastResult?.matchConfidence ?? 0;
  }

  update(prior: DimensionSnapshotInput, observation: number, k: number, alphaMin: number): DimensionSnapshotInput {
    return applyObservation(prior, observation, k, alphaMin);
  }

  reset(): void {
    this.counts = new Map();
    this.lastResult = null;
  }
}
