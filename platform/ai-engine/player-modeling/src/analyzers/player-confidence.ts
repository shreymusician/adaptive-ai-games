/**
 * Confidence (the player's) — whitepaper §3.2: "Composite: decision latency
 * trending down + risk-taking trending up after early success, or the
 * inverse after a loss streak ... computed from the trend of other
 * dimensions within a match." The only dimension that declares `dependsOn`
 * in this phase, demonstrating the registry's dependency ordering: it reads
 * `decisionSpeed`/`riskTolerance`'s THIS-RUN `matchConfidence` from
 * `siblingResults` to bound its own confidence — a composite signal can
 * never be more trustworthy than the inputs it composites, so its evidence
 * gate is capped by its dependencies', not just its own sample volume.
 *
 * The trend itself is computed independently (first-half vs second-half of
 * this match's decisions), not by re-reading the siblings' raw values —
 * their persisted observation is a single per-match scalar in a different
 * unit (mean, not a trend), so it isn't the right shape for this signal.
 */

import { asymptoticConfidence } from '@adaptive-ai/memory-engine';
import { BaseDimensionAnalyzer } from '../analyzer';
import { AnalyzerRunContext, DimensionAnalyzerMetadata, DimensionAnalyzerResult, ShortTermEventRef } from '../types';
import { clamp, mean } from '../stats';

const MATCH_CONFIDENCE_K = 6;

function latencyOf(context: Record<string, unknown> | undefined): number | undefined {
  if (!context) return undefined;
  if (typeof context.decisionLatencyMs === 'number') return context.decisionLatencyMs;
  if (typeof context.reactionMs === 'number') return context.reactionMs;
  return undefined;
}

export class PlayerConfidenceAnalyzer extends BaseDimensionAnalyzer {
  readonly metadata: DimensionAnalyzerMetadata = {
    id: 'confidence',
    displayName: "Confidence (player's)",
    version: 1,
    kind: 'continuous',
    scope: 'per-game',
    dependsOn: ['decisionSpeed', 'riskTolerance'],
    description: 'Composite of within-match decision-latency and risk-taking trend, gated by the confidence of the dimensions it composites.',
  };

  private latencies: number[] = [];
  private risks: number[] = [];
  private siblingConfidenceFloor = 1;

  protected resetAccumulator(): void {
    this.latencies = [];
    this.risks = [];
    this.siblingConfidenceFloor = 1;
  }

  consumeEvent(_event: ShortTermEventRef, _ctx: AnalyzerRunContext): void {}

  consumeMatch(ctx: AnalyzerRunContext): void {
    for (const decision of ctx.match.recentDecisions) {
      const latency = latencyOf(decision.context);
      if (latency !== undefined) this.latencies.push(latency);
      const risk = decision.context?.riskLevel;
      if (typeof risk === 'number') this.risks.push(risk);
    }
    const dependencyConfidences = (this.metadata.dependsOn ?? []).map((dep) => ctx.siblingResults.get(dep)?.matchConfidence ?? 0);
    this.siblingConfidenceFloor = dependencyConfidences.length > 0 ? Math.min(...dependencyConfidences) : 0;
  }

  private trendOf(values: number[]): number {
    if (values.length < 2) return 0;
    const mid = Math.floor(values.length / 2);
    return mean(values.slice(mid)) - mean(values.slice(0, mid));
  }

  protected deriveResult(): DimensionAnalyzerResult {
    if (this.latencies.length < 2 && this.risks.length < 2) {
      return { entries: [], matchConfidence: 0, metadata: { reason: 'insufficient within-match trend data' } };
    }

    const meanLatency = this.latencies.length > 0 ? mean(this.latencies) : 0;
    const latencyTrend = this.trendOf(this.latencies);
    // Falling latency (negative trend) reads as MORE confident, so invert; normalize by the match's own mean latency to stay unit-independent.
    const normalizedLatencyTrend = meanLatency > 0 ? clamp(-latencyTrend / meanLatency, -1, 1) : 0;
    const riskTrend = clamp(this.trendOf(this.risks), -1, 1);

    const composite = clamp(0.5 * normalizedLatencyTrend + 0.5 * riskTrend, -1, 1);
    const observation = (composite + 1) / 2;

    const volumeCount = this.latencies.length + this.risks.length;
    const volumeFactor = asymptoticConfidence(volumeCount, MATCH_CONFIDENCE_K);
    const matchConfidence = Math.min(volumeFactor, this.siblingConfidenceFloor);

    return {
      entries: [{ key: this.metadata.id, observation, sampleCount: volumeCount }],
      matchConfidence,
      metadata: { normalizedLatencyTrend, riskTrend, siblingConfidenceFloor: this.siblingConfidenceFloor },
    };
  }
}
