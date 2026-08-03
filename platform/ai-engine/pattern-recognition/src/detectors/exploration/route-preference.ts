/**
 * Route Preference — competing-categorical. Signal: `PlayerMoved` events
 * with `payload.context === 'exploration'` and a `payload.routeId` string
 * — the general-exploration counterpart to movement/escape-routes.ts's
 * escape-specific routes.
 */

import { BasePatternDetector } from '../../detector';
import { DetectorRunContext, PatternDetectorMetadata, ShortTermEventRef } from '../../types';

export class RoutePreferenceDetector extends BasePatternDetector {
  readonly metadata: PatternDetectorMetadata = {
    id: 'routePreference',
    displayName: 'Route Preference',
    category: 'exploration',
    version: 1,
    description: 'Which route the player takes while exploring, relative to their own total exploration movements.',
  };

  private counts = new Map<string, number>();

  consumeEvent(event: ShortTermEventRef, _ctx: DetectorRunContext): void {
    if (event.type !== 'PlayerMoved') return;
    if (event.payload.context !== 'exploration') return;
    const routeId = event.payload.routeId;
    if (typeof routeId !== 'string') return;
    this.counts.set(routeId, (this.counts.get(routeId) ?? 0) + 1);
  }

  consumeMatch(_ctx: DetectorRunContext): void {
    this.observeCategorical(this.counts, (routeId) => `Explores via route "${routeId}" more often than any other.`);
  }

  protected override resetAccumulator(): void {
    this.counts = new Map();
  }
}
