/**
 * The standard detector interface every pattern implements.
 * ADAPTIVE_AI_ENGINE_WHITEPAPER.md §5 — every pattern type is an
 * independent, isolated detector; the registry (see registry.ts) executes
 * them without knowing their implementation details.
 *
 * Lifecycle, called once per (player, match) run, in this exact order:
 *   metadata()      — static descriptor, may be read at any time
 *   initialize(ctx) — reset internal accumulator, capture the run context
 *   consumeEvent()  — called once per raw event in the match's event log
 *   consumeMatch()  — called once, after every event, with match-level context
 *   detect()        — pure: derive this match's (opportunities, matches) deltas per patternKey
 *   confidence()    — pure: how much evidence this match contributed overall (the per-match gate)
 *   reset()         — clear the accumulator so the SAME instance can be reused for the next run
 */

import { asymptoticConfidence } from '@adaptive-ai/memory-engine';
import { DetectorResult, DetectorRunContext, PatternDetectorMetadata, ShortTermEventRef } from './types';

export interface PatternDetector {
  readonly metadata: PatternDetectorMetadata;
  initialize(ctx: DetectorRunContext): void;
  consumeEvent(event: ShortTermEventRef, ctx: DetectorRunContext): void;
  consumeMatch(ctx: DetectorRunContext): void;
  detect(): DetectorResult;
  confidence(): number;
  reset(): void;
}

export type PatternDetectorFactory = () => PatternDetector;

interface Tally {
  opportunities: number;
  matches: number;
  description: string;
  metadata?: Record<string, unknown>;
}

/** How many total qualifying opportunities this match are needed for the per-match evidence gate to reach ~0.5 — a low bar, since patterns are expected to accumulate slowly across MANY matches, not within one. */
const MATCH_EVIDENCE_K = 3;

/**
 * Shared plumbing every detector needs: context capture, the tally
 * accumulator, and the match-evidence confidence gate. Subclasses implement
 * only `consumeEvent`/`consumeMatch` — calling `observeBinary()` or
 * `observeCategorical()` — keeping each pattern's file small and
 * self-contained. Shared BASE-CLASS PLUMBING, not a shared god-object: each
 * subclass instance owns only its own accumulator and registers
 * independently (same rationale as player-modeling's BaseDimensionAnalyzer).
 */
export abstract class BasePatternDetector implements PatternDetector {
  protected ctx!: DetectorRunContext;
  private tallies: Map<string, Tally> = new Map();
  private lastConfidence = 0;

  abstract readonly metadata: PatternDetectorMetadata;

  initialize(ctx: DetectorRunContext): void {
    this.ctx = ctx;
    this.tallies = new Map();
    this.lastConfidence = 0;
    this.resetAccumulator();
  }

  /** Subclasses with their own accumulator fields beyond the shared tally map (e.g. a running counter) override this to clear them. Called by both initialize() and reset() — default no-op for detectors that need nothing beyond the shared tallies. */
  protected resetAccumulator(): void {}

  abstract consumeEvent(event: ShortTermEventRef, ctx: DetectorRunContext): void;

  consumeMatch(_ctx: DetectorRunContext): void {
    // Most detectors derive entirely from per-event consumption; override for match-level adjustments.
  }

  /**
   * For a FIXED-HYPOTHESIS binary habit (e.g. "reloads after exactly 2
   * shots"): every qualifying event is one opportunity, `matched` records
   * whether THIS instance was consistent with the claim. Call once per
   * qualifying event.
   */
  protected observeBinary(patternKey: string, matched: boolean, description: string, metadata?: Record<string, unknown>): void {
    const entry = this.tallies.get(patternKey) ?? { opportunities: 0, matches: 0, description };
    entry.opportunities += 1;
    if (matched) entry.matches += 1;
    entry.description = description;
    if (metadata) entry.metadata = metadata;
    this.tallies.set(patternKey, entry);
  }

  /**
   * For a COMPETING-CATEGORICAL habit (e.g. preferred dodge direction: no
   * single privileged hypothesis — every category shares the same
   * opportunity pool). `counts` is this match's raw tally per category;
   * each key's `opportunities` becomes the FULL total across all
   * categories (not just its own count) so its concentration reflects "this
   * category's share of every categorical choice this match" — the same
   * share-based shape as player-modeling's categorical dimensions. Call
   * once, typically from `consumeMatch`.
   *
   * Categories this player has previously demonstrated (discovered via
   * `ctx.priorPatterns`, this detector's own past output) but that got ZERO
   * votes this match are still included, at count 0 — otherwise a category
   * that used to be the habit but has been fully replaced would simply
   * never appear again instead of being CONTRADICTED, and would never
   * decay (whitepaper §5.2's "detect a patched habit quickly" requires an
   * actual contradicting observation, not silence).
   */
  protected observeCategorical(counts: Map<string, number>, describe: (key: string) => string, metadata?: (key: string) => Record<string, unknown> | undefined): void {
    const merged = new Map(counts);
    for (const key of this.priorCategoricalKeys()) {
      if (!merged.has(key)) merged.set(key, 0);
    }
    const total = [...merged.values()].reduce((a, b) => a + b, 0);
    if (total === 0) return;
    for (const [key, count] of merged) {
      this.tallies.set(key, { opportunities: total, matches: count, description: describe(key), metadata: metadata?.(key) });
    }
  }

  /** Every patternKey this detector has previously produced for this player+game, read from `ctx.priorPatterns` (keyed `${detectorId}:${patternKey}`). */
  private priorCategoricalKeys(): string[] {
    const prefix = `${this.metadata.id}:`;
    const keys: string[] = [];
    for (const id of this.ctx.priorPatterns.keys()) {
      if (id.startsWith(prefix)) keys.push(id.slice(prefix.length));
    }
    return keys;
  }

  detect(): DetectorResult {
    const deltas = [...this.tallies.entries()].map(([patternKey, t]) => ({
      patternKey,
      description: t.description,
      opportunities: t.opportunities,
      matches: t.matches,
      metadata: t.metadata,
    }));
    const totalOpportunities = deltas.reduce((sum, d) => sum + d.opportunities, 0);
    this.lastConfidence = asymptoticConfidence(totalOpportunities, MATCH_EVIDENCE_K);
    return { deltas };
  }

  confidence(): number {
    return this.lastConfidence;
  }

  reset(): void {
    this.tallies = new Map();
    this.lastConfidence = 0;
    this.resetAccumulator();
  }
}
