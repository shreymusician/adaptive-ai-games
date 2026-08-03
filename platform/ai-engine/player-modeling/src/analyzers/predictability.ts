/**
 * Predictability — whitepaper §3.2/§5: "the complement of Pattern
 * Recognition's own entropy measure — these two are two views of one
 * underlying signal, not independently computed." Pattern Recognition
 * (whitepaper §5) has not been implemented yet, so this analyzer computes a
 * PROVISIONAL, self-referential proxy directly from this match's chosen-action
 * distribution (`recentDecisions[].chosenAction`): `1 - normalizedEntropy`.
 * Once Pattern Recognition ships, it should become the single source of
 * this signal and this analyzer should be simplified to read it, per the
 * whitepaper's explicit "not independently computed" instruction — flagged
 * in README "Known limitations".
 */

import { asymptoticConfidence } from '@adaptive-ai/memory-engine';
import { BaseDimensionAnalyzer } from '../analyzer';
import { AnalyzerRunContext, DimensionAnalyzerMetadata, DimensionAnalyzerResult, ShortTermEventRef } from '../types';
import { normalizedEntropy } from '../stats';

const MATCH_CONFIDENCE_K = 8;

export class PredictabilityAnalyzer extends BaseDimensionAnalyzer {
  readonly metadata: DimensionAnalyzerMetadata = {
    id: 'predictability',
    displayName: 'Predictability',
    version: 1,
    kind: 'continuous',
    scope: 'per-game',
    description: "Provisional proxy: 1 minus the normalized entropy of this match's chosen-action distribution.",
  };

  private actionCounts: Map<string, number> = new Map();
  private total = 0;

  protected resetAccumulator(): void {
    this.actionCounts = new Map();
    this.total = 0;
  }

  consumeEvent(_event: ShortTermEventRef, _ctx: AnalyzerRunContext): void {}

  consumeMatch(ctx: AnalyzerRunContext): void {
    for (const decision of ctx.match.recentDecisions) {
      this.actionCounts.set(decision.chosenAction, (this.actionCounts.get(decision.chosenAction) ?? 0) + 1);
      this.total += 1;
    }
  }

  protected deriveResult(): DimensionAnalyzerResult {
    if (this.total === 0) {
      return { entries: [], matchConfidence: 0, metadata: { sampleCount: 0 } };
    }
    const observation = 1 - normalizedEntropy(this.actionCounts);
    const matchConfidence = asymptoticConfidence(this.total, MATCH_CONFIDENCE_K);
    return {
      entries: [{ key: this.metadata.id, observation, sampleCount: this.total }],
      matchConfidence,
      metadata: { distinctActions: this.actionCounts.size, sampleCount: this.total },
    };
  }
}
