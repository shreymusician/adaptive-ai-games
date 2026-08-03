/**
 * Consistency — whitepaper §3.2: "Inverse of variance across repeated
 * instances of the same decision context." Signal source: this match's
 * decision latencies (`context.decisionLatencyMs`, falling back to
 * `context.reactionMs`) — the same repeated-context proxy used by Decision
 * Speed/Reaction Time, recomputed independently here so this analyzer stays
 * fully self-contained (whitepaper: "isolated from every other analyzer").
 */

import { asymptoticConfidence } from '@adaptive-ai/memory-engine';
import { BaseDimensionAnalyzer } from '../analyzer';
import { AnalyzerRunContext, DimensionAnalyzerMetadata, DimensionAnalyzerResult, ShortTermEventRef } from '../types';
import { variance } from '../stats';

const MATCH_CONFIDENCE_K = 6;
/** Variance (ms^2) at which the consistency score is squashed to ~0.5 — tuned for typical decision-latency spreads, not a universal constant. */
const VARIANCE_SCALE = 40_000;

export class ConsistencyAnalyzer extends BaseDimensionAnalyzer {
  readonly metadata: DimensionAnalyzerMetadata = {
    id: 'consistency',
    displayName: 'Consistency',
    version: 1,
    kind: 'continuous',
    scope: 'per-game',
    description: "Inverse of this match's decision-latency variance — high when repeated decisions take a similar amount of time.",
  };

  private latenciesMs: number[] = [];

  protected resetAccumulator(): void {
    this.latenciesMs = [];
  }

  consumeEvent(_event: ShortTermEventRef, _ctx: AnalyzerRunContext): void {}

  consumeMatch(ctx: AnalyzerRunContext): void {
    for (const decision of ctx.match.recentDecisions) {
      const context = decision.context ?? {};
      const latencyMs = typeof context.decisionLatencyMs === 'number' ? context.decisionLatencyMs : typeof context.reactionMs === 'number' ? context.reactionMs : undefined;
      if (latencyMs !== undefined) this.latenciesMs.push(latencyMs);
    }
  }

  protected deriveResult(): DimensionAnalyzerResult {
    // Variance is only meaningful with at least 2 repeated instances.
    if (this.latenciesMs.length < 2) {
      return { entries: [], matchConfidence: 0, metadata: { sampleCount: this.latenciesMs.length } };
    }
    const v = variance(this.latenciesMs);
    const observation = VARIANCE_SCALE / (VARIANCE_SCALE + v);
    const matchConfidence = asymptoticConfidence(this.latenciesMs.length, MATCH_CONFIDENCE_K);
    return {
      entries: [{ key: this.metadata.id, observation, sampleCount: this.latenciesMs.length }],
      matchConfidence,
      metadata: { variance: v, sampleCount: this.latenciesMs.length },
    };
  }
}
