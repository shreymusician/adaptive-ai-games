/**
 * Target Prioritization — competing-categorical. Signal: `TargetAcquired`
 * events with a `payload.targetType` string (e.g. 'healer', 'tank',
 * 'lowest-health', 'nearest' — a plugin-declared role/heuristic tag).
 */

import { BasePatternDetector } from '../../detector';
import { DetectorRunContext, PatternDetectorMetadata, ShortTermEventRef } from '../../types';

export class TargetPrioritizationDetector extends BasePatternDetector {
  readonly metadata: PatternDetectorMetadata = {
    id: 'targetPrioritization',
    displayName: 'Target Prioritization',
    category: 'combat',
    version: 1,
    description: 'Which target type/role the player acquires most often, relative to their own total target acquisitions.',
  };

  private counts = new Map<string, number>();

  consumeEvent(event: ShortTermEventRef, _ctx: DetectorRunContext): void {
    if (event.type !== 'TargetAcquired') return;
    const targetType = event.payload.targetType;
    if (typeof targetType !== 'string') return;
    this.counts.set(targetType, (this.counts.get(targetType) ?? 0) + 1);
  }

  consumeMatch(_ctx: DetectorRunContext): void {
    this.observeCategorical(this.counts, (targetType) => `Prioritizes "${targetType}" targets more often than any other type.`);
  }

  protected override resetAccumulator(): void {
    this.counts = new Map();
  }
}
