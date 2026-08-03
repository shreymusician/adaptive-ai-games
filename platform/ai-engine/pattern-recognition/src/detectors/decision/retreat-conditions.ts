/**
 * Retreat Conditions — competing-categorical over health bands. Signal:
 * `recentDecisions` where `chosenAction === 'retreat'` and
 * `context.healthPercent` (0-1) is present, bucketed via
 * `PatternRecognitionConfig.healthBuckets`. The dominant band across
 * matches is the health threshold at which this player habitually retreats.
 */

import { healthBand } from '../../config';
import { BasePatternDetector } from '../../detector';
import { DetectorRunContext, PatternDetectorMetadata, ShortTermEventRef } from '../../types';

export class RetreatConditionsDetector extends BasePatternDetector {
  readonly metadata: PatternDetectorMetadata = {
    id: 'retreatConditions',
    displayName: 'Retreat Conditions',
    category: 'decision',
    version: 1,
    description: 'The health band at which the player most often chooses to retreat, relative to all their retreat decisions.',
  };

  private counts = new Map<string, number>();

  consumeEvent(_event: ShortTermEventRef, _ctx: DetectorRunContext): void {}

  consumeMatch(ctx: DetectorRunContext): void {
    for (const decision of ctx.match.recentDecisions) {
      if (decision.chosenAction !== 'retreat') continue;
      const healthPercent = decision.context?.healthPercent;
      if (typeof healthPercent !== 'number') continue;
      const band = healthBand(healthPercent, ctx.settings.healthBuckets);
      this.counts.set(band, (this.counts.get(band) ?? 0) + 1);
    }
    this.observeCategorical(this.counts, (band) => `Retreats most often when health is in the "${band}%" band.`);
  }

  protected override resetAccumulator(): void {
    this.counts = new Map();
  }
}
