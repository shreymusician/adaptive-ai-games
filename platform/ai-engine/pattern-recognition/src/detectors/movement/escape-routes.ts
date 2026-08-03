/**
 * Preferred Escape Routes — competing-categorical. Signal: `PlayerMoved`
 * events with `payload.context === 'escape'` and a `payload.routeId` string
 * (a plugin-declared waypoint/corridor identifier). Whitepaper §11 flags
 * escape-route patterns as inherently map/movement-system-specific — never
 * cross-game.
 */

import { BasePatternDetector } from '../../detector';
import { DetectorRunContext, PatternDetectorMetadata, ShortTermEventRef } from '../../types';

export class EscapeRoutesDetector extends BasePatternDetector {
  readonly metadata: PatternDetectorMetadata = {
    id: 'escapeRoutes',
    displayName: 'Preferred Escape Routes',
    category: 'movement',
    version: 1,
    description: 'Which declared escape route the player takes, relative to their own total escapes.',
  };

  private counts = new Map<string, number>();

  consumeEvent(event: ShortTermEventRef, _ctx: DetectorRunContext): void {
    if (event.type !== 'PlayerMoved') return;
    if (event.payload.context !== 'escape') return;
    const routeId = event.payload.routeId;
    if (typeof routeId !== 'string') return;
    this.counts.set(routeId, (this.counts.get(routeId) ?? 0) + 1);
  }

  consumeMatch(_ctx: DetectorRunContext): void {
    this.observeCategorical(this.counts, (routeId) => `Uses escape route "${routeId}" more often than any other.`);
  }

  protected override resetAccumulator(): void {
    this.counts = new Map();
  }
}
