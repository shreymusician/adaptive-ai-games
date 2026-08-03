/**
 * Risk Tolerance — whitepaper §3.2: "rate of high-danger-window actions ...
 * relative to available safer options." Signal source: `recentDecisions`
 * with `context.riskLevel` (an Influence-Map-style [0,1] local danger
 * reading at decision time, supplied by the plugin/behavior-analysis
 * layer). A decision with no `riskLevel` contributes no evidence.
 */

import { asymptoticConfidence } from '@adaptive-ai/memory-engine';
import { BaseDimensionAnalyzer } from '../analyzer';
import { AnalyzerRunContext, DimensionAnalyzerMetadata, DimensionAnalyzerResult, ShortTermEventRef } from '../types';

const MATCH_CONFIDENCE_K = 6;

export class RiskToleranceAnalyzer extends BaseDimensionAnalyzer {
  readonly metadata: DimensionAnalyzerMetadata = {
    id: 'riskTolerance',
    displayName: 'Risk Tolerance',
    version: 1,
    kind: 'continuous',
    scope: 'per-game',
    description: 'Share of risk-scored decisions this match taken at or above the configured high-risk threshold.',
  };

  private highRiskCount = 0;
  private riskScoredCount = 0;

  protected resetAccumulator(): void {
    this.highRiskCount = 0;
    this.riskScoredCount = 0;
  }

  consumeEvent(_event: ShortTermEventRef, _ctx: AnalyzerRunContext): void {}

  consumeMatch(ctx: AnalyzerRunContext): void {
    const threshold = ctx.settings.highRiskThreshold;
    for (const decision of ctx.match.recentDecisions) {
      const riskLevel = decision.context?.riskLevel;
      if (typeof riskLevel !== 'number') continue;
      this.riskScoredCount += 1;
      if (riskLevel >= threshold) this.highRiskCount += 1;
    }
  }

  protected deriveResult(): DimensionAnalyzerResult {
    if (this.riskScoredCount === 0) {
      return { entries: [], matchConfidence: 0, metadata: { riskScoredCount: 0 } };
    }
    const observation = this.highRiskCount / this.riskScoredCount;
    const matchConfidence = asymptoticConfidence(this.riskScoredCount, MATCH_CONFIDENCE_K);
    return {
      entries: [{ key: this.metadata.id, observation, sampleCount: this.riskScoredCount }],
      matchConfidence,
      metadata: { highRiskCount: this.highRiskCount, riskScoredCount: this.riskScoredCount },
    };
  }
}
