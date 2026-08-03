/**
 * Learning Rate — whitepaper §3.2: "Second derivative — how quickly the
 * player's own skill dimensions are trending upward over their match
 * history ... directly computable from already-stored profile history."
 *
 * Unlike every other analyzer here, this one's evidence isn't this match's
 * events — it's the bounded recent version history of `mechanicalSkill` and
 * `strategicSkill` (declared via `historyDependsOn`, prefetched by the
 * engine — see PlayerModelingConfig.historyLookbackVersions). This keeps
 * the read O(historyLookbackVersions), never a full-history recompute.
 */

import { asymptoticConfidence } from '@adaptive-ai/memory-engine';
import { BaseDimensionAnalyzer } from '../analyzer';
import { AnalyzerRunContext, DimensionAnalyzerMetadata, DimensionAnalyzerResult, ShortTermEventRef } from '../types';
import { mean } from '../stats';

const MATCH_CONFIDENCE_K = 4;

/** Average first-difference slope across a most-recent-first version series. Returns null if fewer than 2 versions are available. */
function averageSlope(series: { value: number; version: number }[] | undefined): number | null {
  if (!series || series.length < 2) return null;
  // series is most-recent-first; walk oldest->newest to get a forward-time slope.
  const chronological = [...series].reverse();
  const slopes: number[] = [];
  for (let i = 1; i < chronological.length; i++) {
    slopes.push(chronological[i].value - chronological[i - 1].value);
  }
  return mean(slopes);
}

export class LearningRateAnalyzer extends BaseDimensionAnalyzer {
  readonly metadata: DimensionAnalyzerMetadata = {
    id: 'learningRate',
    displayName: 'Learning Rate',
    version: 1,
    kind: 'continuous',
    scope: 'per-game',
    historyDependsOn: ['mechanicalSkill', 'strategicSkill'],
    description: "Average of the recent-history slopes of the player's own mechanicalSkill and strategicSkill dimensions.",
  };

  private slopes: number[] = [];
  private versionsSeen = 0;

  protected resetAccumulator(): void {
    this.slopes = [];
    this.versionsSeen = 0;
  }

  consumeEvent(_event: ShortTermEventRef, _ctx: AnalyzerRunContext): void {}

  consumeMatch(ctx: AnalyzerRunContext): void {
    for (const dimension of this.metadata.historyDependsOn ?? []) {
      const series = ctx.historicalSeries.get(dimension);
      this.versionsSeen += series?.length ?? 0;
      const slope = averageSlope(series);
      if (slope !== null) this.slopes.push(slope);
    }
  }

  protected deriveResult(): DimensionAnalyzerResult {
    if (this.slopes.length === 0) {
      return { entries: [], matchConfidence: 0, metadata: { versionsSeen: this.versionsSeen } };
    }
    const observation = mean(this.slopes);
    const matchConfidence = asymptoticConfidence(this.versionsSeen, MATCH_CONFIDENCE_K);
    return {
      entries: [{ key: this.metadata.id, observation, sampleCount: this.versionsSeen }],
      matchConfidence,
      metadata: { dimensionsWithHistory: this.slopes.length, versionsSeen: this.versionsSeen },
    };
  }
}
