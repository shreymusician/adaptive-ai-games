/**
 * Strategic Skill — whitepaper §3.2: "was a chosen action followed by a
 * favorable state-change within a bounded horizon ... hardest dimension to
 * generalize well — genuinely needs a per-plugin Decision Adapter to define
 * 'favorable'." Preferred signal: `recentDecisions[].context.favorableOutcome`
 * (boolean), set by that per-plugin adapter. When no decision in the match
 * carries this field, this analyzer falls back to the match-level
 * `statistics.outcome` convention (1 win / 0.5 draw / 0 loss) as a single,
 * coarse, low-confidence observation — documented explicitly as a fallback,
 * never silently conflated with the richer per-decision signal.
 */

import { asymptoticConfidence } from '@adaptive-ai/memory-engine';
import { BaseDimensionAnalyzer } from '../analyzer';
import { AnalyzerRunContext, DimensionAnalyzerMetadata, DimensionAnalyzerResult, ShortTermEventRef } from '../types';

const MATCH_CONFIDENCE_K = 8;
/** The match-level outcome fallback is coarse (one data point) — capped well below what per-decision evidence could earn. */
const FALLBACK_MATCH_CONFIDENCE_CAP = 0.35;

export class StrategicSkillAnalyzer extends BaseDimensionAnalyzer {
  readonly metadata: DimensionAnalyzerMetadata = {
    id: 'strategicSkill',
    displayName: 'Strategic Skill',
    version: 1,
    kind: 'continuous',
    scope: 'per-game',
    description: "Share of this match's decisions flagged favorable by the plugin's Decision Adapter, falling back to overall match outcome when no decision-level signal exists.",
  };

  private favorableDecisions = 0;
  private flaggedDecisions = 0;

  protected resetAccumulator(): void {
    this.favorableDecisions = 0;
    this.flaggedDecisions = 0;
  }

  consumeEvent(_event: ShortTermEventRef, _ctx: AnalyzerRunContext): void {}

  consumeMatch(ctx: AnalyzerRunContext): void {
    for (const decision of ctx.match.recentDecisions) {
      const favorable = decision.context?.favorableOutcome;
      if (typeof favorable !== 'boolean') continue;
      this.flaggedDecisions += 1;
      if (favorable) this.favorableDecisions += 1;
    }
  }

  protected deriveResult(): DimensionAnalyzerResult {
    if (this.flaggedDecisions > 0) {
      const observation = this.favorableDecisions / this.flaggedDecisions;
      const matchConfidence = asymptoticConfidence(this.flaggedDecisions, MATCH_CONFIDENCE_K);
      return {
        entries: [{ key: this.metadata.id, observation, sampleCount: this.flaggedDecisions }],
        matchConfidence,
        metadata: { source: 'decision-adapter', flaggedDecisions: this.flaggedDecisions },
      };
    }

    const outcome = this.ctx.match.statistics.outcome;
    if (typeof outcome !== 'number') {
      return { entries: [], matchConfidence: 0, metadata: { source: 'none' } };
    }
    return {
      entries: [{ key: this.metadata.id, observation: outcome, sampleCount: 1 }],
      matchConfidence: FALLBACK_MATCH_CONFIDENCE_CAP,
      metadata: { source: 'match-outcome-fallback' },
    };
  }
}
