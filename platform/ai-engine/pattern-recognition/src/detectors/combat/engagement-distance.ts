/**
 * Preferred Engagement Distance — competing-categorical. Signal:
 * `PlayerDamaged` events with a numeric `payload.distance` (world units,
 * genre-relative), bucketed via `PatternRecognitionConfig.engagementDistanceBuckets`
 * into close/mid/long — the same bucketing shape as player-modeling's
 * Preferred Combat Distance dimension, but tracked here as a discrete
 * pattern with its own lifecycle/confidence rather than a continuous EWMA
 * share.
 */

import { BasePatternDetector } from '../../detector';
import { DetectorRunContext, PatternDetectorMetadata, ShortTermEventRef } from '../../types';

export class EngagementDistanceDetector extends BasePatternDetector {
  readonly metadata: PatternDetectorMetadata = {
    id: 'engagementDistance',
    displayName: 'Preferred Engagement Distance',
    category: 'combat',
    version: 1,
    description: 'Which combat-distance bucket the player fights from most often, relative to their own total engagements.',
  };

  private counts = new Map<string, number>();

  consumeEvent(event: ShortTermEventRef, ctx: DetectorRunContext): void {
    if (event.type !== 'PlayerDamaged') return;
    const distance = event.payload.distance;
    if (typeof distance !== 'number') return;
    const { closeMax, midMax } = ctx.settings.engagementDistanceBuckets;
    const bucket = distance <= closeMax ? 'close' : distance <= midMax ? 'mid' : 'long';
    this.counts.set(bucket, (this.counts.get(bucket) ?? 0) + 1);
  }

  consumeMatch(_ctx: DetectorRunContext): void {
    this.observeCategorical(this.counts, (bucket) => `Engages at ${bucket} range more often than any other range.`);
  }

  protected override resetAccumulator(): void {
    this.counts = new Map();
  }
}
