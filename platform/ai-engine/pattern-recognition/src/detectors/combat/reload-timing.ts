/**
 * Reload Timing — competing-categorical. Signal: `AbilityUsed` events with
 * `payload.weaponAction === 'shoot'` increment a running shot counter;
 * `payload.weaponAction === 'reload'` tallies the shot count AT that moment
 * as this reload's category (`after-N-shots`). The dominant N across a
 * match (and across many matches, via the persisted EWMA-style running
 * totals) is the player's reload-timing habit.
 */

import { BasePatternDetector } from '../../detector';
import { DetectorRunContext, PatternDetectorMetadata, ShortTermEventRef } from '../../types';

export class ReloadTimingDetector extends BasePatternDetector {
  readonly metadata: PatternDetectorMetadata = {
    id: 'reloadTiming',
    displayName: 'Reload Timing',
    category: 'combat',
    version: 1,
    description: 'How many shots the player fires before reloading, relative to their own total reloads.',
  };

  private shotsSinceReload = 0;
  private counts = new Map<string, number>();

  consumeEvent(event: ShortTermEventRef, _ctx: DetectorRunContext): void {
    if (event.type !== 'AbilityUsed') return;
    if (event.payload.weaponAction === 'shoot') {
      this.shotsSinceReload += 1;
    } else if (event.payload.weaponAction === 'reload') {
      const key = `after-${this.shotsSinceReload}-shots`;
      this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
      this.shotsSinceReload = 0;
    }
  }

  consumeMatch(_ctx: DetectorRunContext): void {
    this.observeCategorical(this.counts, (key) => `Reloads ${key.replace('-', ' ')} more often than any other timing.`);
  }

  protected override resetAccumulator(): void {
    this.shotsSinceReload = 0;
    this.counts = new Map();
  }
}
