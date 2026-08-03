/**
 * Corner Preference — competing-categorical. Signal: `PlayerMoved` events
 * with `payload.nearCorner === true` and a `payload.cornerId` string
 * (a plugin-declared map landmark identifier).
 */

import { BasePatternDetector } from '../../detector';
import { DetectorRunContext, PatternDetectorMetadata, ShortTermEventRef } from '../../types';

export class CornerPreferenceDetector extends BasePatternDetector {
  readonly metadata: PatternDetectorMetadata = {
    id: 'cornerPreference',
    displayName: 'Corner Preference',
    category: 'movement',
    version: 1,
    description: 'Which map corner/landmark the player gravitates toward, relative to their own total corner visits.',
  };

  private counts = new Map<string, number>();

  consumeEvent(event: ShortTermEventRef, _ctx: DetectorRunContext): void {
    if (event.type !== 'PlayerMoved') return;
    if (event.payload.nearCorner !== true) return;
    const cornerId = event.payload.cornerId;
    if (typeof cornerId !== 'string') return;
    this.counts.set(cornerId, (this.counts.get(cornerId) ?? 0) + 1);
  }

  consumeMatch(_ctx: DetectorRunContext): void {
    this.observeCategorical(this.counts, (cornerId) => `Gravitates toward corner "${cornerId}" more often than any other.`);
  }

  protected override resetAccumulator(): void {
    this.counts = new Map();
  }
}
