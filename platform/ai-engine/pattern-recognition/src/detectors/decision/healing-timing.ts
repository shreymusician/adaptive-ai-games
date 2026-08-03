/**
 * Healing Timing — competing-categorical over health bands. Signal:
 * `AbilityUsed` events with `payload.abilityType === 'heal'` and a numeric
 * `payload.healthPercent` (the caster's own health at cast time), bucketed
 * via `PatternRecognitionConfig.healthBuckets`.
 */

import { healthBand } from '../../config';
import { BasePatternDetector } from '../../detector';
import { DetectorRunContext, PatternDetectorMetadata, ShortTermEventRef } from '../../types';

export class HealingTimingDetector extends BasePatternDetector {
  readonly metadata: PatternDetectorMetadata = {
    id: 'healingTiming',
    displayName: 'Healing Timing',
    category: 'decision',
    version: 1,
    description: 'The health band at which the player most often chooses to heal, relative to all their healing decisions.',
  };

  private counts = new Map<string, number>();

  consumeEvent(event: ShortTermEventRef, ctx: DetectorRunContext): void {
    if (event.type !== 'AbilityUsed') return;
    if (event.payload.abilityType !== 'heal') return;
    const healthPercent = event.payload.healthPercent;
    if (typeof healthPercent !== 'number') return;
    const band = healthBand(healthPercent, ctx.settings.healthBuckets);
    this.counts.set(band, (this.counts.get(band) ?? 0) + 1);
  }

  consumeMatch(_ctx: DetectorRunContext): void {
    this.observeCategorical(this.counts, (band) => `Heals most often when health is in the "${band}%" band.`);
  }

  protected override resetAccumulator(): void {
    this.counts = new Map();
  }
}
