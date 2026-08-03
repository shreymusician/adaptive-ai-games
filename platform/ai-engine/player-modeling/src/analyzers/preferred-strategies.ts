/**
 * Preferred Strategies — whitepaper §3.2: "Top-weighted entries from the
 * same categorical-EWMA machinery used for Favorite Weapon/Ability."
 * Signal source: `recentDecisions[].context.strategyTag` when the plugin
 * supplies one; falls back to the raw `chosenAction` string as the category
 * otherwise, so this dimension is never empty purely for lack of an
 * explicit strategy taxonomy.
 */

import { BaseCategoricalAnalyzer } from '../analyzer';
import { AnalyzerRunContext, DimensionAnalyzerMetadata, ShortTermEventRef } from '../types';

export class PreferredStrategiesAnalyzer extends BaseCategoricalAnalyzer {
  readonly metadata: DimensionAnalyzerMetadata = {
    id: 'preferredStrategies',
    displayName: 'Preferred Strategies',
    version: 1,
    kind: 'categorical',
    scope: 'per-game',
    description: "Frequency table over this match's decision strategy tags (or chosen actions, as a fallback category).",
  };

  consumeEvent(_event: ShortTermEventRef, _ctx: AnalyzerRunContext): void {
    // Preferred Strategies derives from the curated recentDecisions list (consumeMatch), not raw events.
  }

  consumeMatch(ctx: AnalyzerRunContext): void {
    for (const decision of ctx.match.recentDecisions) {
      const strategyTag = decision.context?.strategyTag;
      const category = typeof strategyTag === 'string' && strategyTag.length > 0 ? strategyTag : decision.chosenAction;
      this.tally(category);
    }
  }
}
