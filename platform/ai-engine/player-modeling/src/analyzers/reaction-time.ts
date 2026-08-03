/**
 * Reaction Time — whitepaper §3.2: "Δt from a stimulus-class event to the
 * paired response event. Genre-specific pairing rules, declared per plugin."
 *
 * Signal source: each match's `recentDecisions` (Short-Term Memory), where
 * the plugin/host is expected to populate `context.reactionMs` directly, or
 * `context.stimulusTs` so this analyzer can compute
 * `decision.ts - context.stimulusTs`. A decision with neither field
 * contributes no evidence (not a zero) — genres without a meaningful
 * stimulus/response pairing simply never populate this dimension, which is
 * the correct behavior per whitepaper §3.2 ("absent from the profile for
 * genres without [the] mechanic, not defaulted to 0").
 *
 * Cross-game transfer note (whitepaper §11): raw milliseconds are stored
 * per-game. A normalized/percentile cross-game form is future work for
 * whichever module performs cross-game rollup (whitepaper §10's daily
 * cadence), not this analyzer's job.
 */

import { asymptoticConfidence } from '@adaptive-ai/memory-engine';
import { BaseDimensionAnalyzer } from '../analyzer';
import { AnalyzerRunContext, DimensionAnalyzerMetadata, DimensionAnalyzerResult, ShortTermEventRef } from '../types';
import { mean } from '../stats';

const MATCH_CONFIDENCE_K = 5; // samples-to-trust-this-match's-read constant; distinct from the persisted dimension's own k

export class ReactionTimeAnalyzer extends BaseDimensionAnalyzer {
  readonly metadata: DimensionAnalyzerMetadata = {
    id: 'reactionTime',
    displayName: 'Reaction Time',
    version: 1,
    kind: 'continuous',
    scope: 'per-game',
    description: 'Mean stimulus-to-response latency (ms) across this match\'s decision points.',
  };

  private latenciesMs: number[] = [];

  protected resetAccumulator(): void {
    this.latenciesMs = [];
  }

  consumeEvent(_event: ShortTermEventRef, _ctx: AnalyzerRunContext): void {
    // Reaction Time derives from the curated recentDecisions list (consumeMatch), not raw events directly.
  }

  consumeMatch(ctx: AnalyzerRunContext): void {
    for (const decision of ctx.match.recentDecisions) {
      const context = decision.context ?? {};
      const reactionMs = typeof context.reactionMs === 'number' ? context.reactionMs : undefined;
      const stimulusTs = typeof context.stimulusTs === 'number' ? context.stimulusTs : undefined;
      if (reactionMs !== undefined) {
        this.latenciesMs.push(reactionMs);
      } else if (stimulusTs !== undefined) {
        this.latenciesMs.push(decision.ts - stimulusTs);
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
