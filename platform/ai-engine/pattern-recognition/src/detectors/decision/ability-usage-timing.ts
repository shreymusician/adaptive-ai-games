/**
 * Ability Usage Timing — fixed-hypothesis binary habit. Signal:
 * `AbilityUsed` events with a numeric `payload.timeSinceCooldownReadyMs` —
 * the qualifying opportunity — matched when that gap is at/below
 * `PatternRecognitionConfig.immediateUsageWindowMs` (fires the instant it's
 * available, rather than holding it in reserve).
 */

import { BasePatternDetector } from '../../detector';
import { DetectorRunContext, PatternDetectorMetadata, ShortTermEventRef } from '../../types';

export class AbilityUsageTimingDetector extends BasePatternDetector {
  readonly metadata: PatternDetectorMetadata = {
    id: 'abilityUsageTiming',
    displayName: 'Ability Usage Timing',
    category: 'decision',
    version: 1,
    description: 'Uses abilities the instant they come off cooldown, rather than holding them in reserve.',
  };

  consumeEvent(event: ShortTermEventRef, ctx: DetectorRunContext): void {
    if (event.type !== 'AbilityUsed') return;
    const gapMs = event.payload.timeSinceCooldownReadyMs;
    if (typeof gapMs !== 'number') return;
    this.observeBinary('immediate-usage', gapMs <= ctx.settings.immediateUsageWindowMs, 'Uses abilities the instant they come off cooldown.');
  }
}
