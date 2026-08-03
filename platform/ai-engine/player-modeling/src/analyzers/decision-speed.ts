/**
 * Decision Speed — whitepaper §3.2/§11: "which option, how fast" — distinct
 * from Reaction Time's raw psychomotor "motor response, how fast". Signal
 * source: `context.decisionLatencyMs` (time from the decision point being
 * OFFERED to the player choosing an action), or `decision.ts - context.offeredAt`
 * when only a raw timestamp is supplied.
 */

import { asymptoticConfidence } from '@adaptive-ai/memory-engine';
import { BaseDimensionAnalyzer } from '../analyzer';
import { AnalyzerRunContext, DimensionAnalyzerMetadata, DimensionAnalyzerResult, ShortTermEventRef } from '../types';
import { mean } from '../stats';

const MATCH_CONFIDENCE_K = 5;

export class DecisionSpeedAnalyzer extends BaseDimensionAnalyzer {
  readonly metadata: DimensionAnalyzerMetadata = {
    id: 'decisionSpeed',
    displayName: 'Decision Speed',
    version: 1,
    kind: 'continuous',
    scope: 'per-game',
    description: 'Mean time (ms) from a decision point being offered to the player choosing an action.',
  };

  private latenciesMs: number[] = [];

  protected resetAccumulator(): void {
    this.latenciesMs = [];
  }

  consumeEvent(_event: ShortTermEventRef, _ctx: AnalyzerRunContext): void {}

  consumeMatch(ctx: AnalyzerRunContext): void {
    for (const decision of ctx.match.recentDecisions) {
      const context = decision.context ?? {};
      const latencyMs = typeof context.decisionLatencyMs === 'number' ? context.decisionLatencyMs : undefined;
      const offeredAt = typeof context.offeredAt === 'number' ? context.offeredAt : undefined;
      if (latencyMs !== undefined) {
        this.latenciesMs.push(latencyMs);
      } else if (offeredAt !== undefined) {
        this.latenciesMs.push(decision.ts - offeredAt);
      }
    }
  }

  protected deriveResult(): DimensionAnalyzerResult {
    if (this.latenciesMs.length === 0) {
      return { entries: [], matchConfidence: 0, metadata: { sampleCount: 0 } };
    }
    const observation = mean(this.latenciesMs);
    const matchConfidence = asymptoticConfidence(this.latenciesMs.length, MATCH_CONFIDENCE_K);
    return {
      entries: [{ key: this.metadata.id, observation, sampleCount: this.latenciesMs.length }],
      matchConfidence,
      metadata: { sampleCount: this.latenciesMs.length },
    };
  }
}
