/**
 * Resource Conservation — fixed-hypothesis binary habit. Signal:
 * `AbilityUsed` events with a numeric `payload.resourceCostRatio` (this
 * ability's cost as a fraction of the player's max resource pool) — the
 * qualifying opportunity — matched when the ratio is at/below
 * `PatternRecognitionConfig.conservingCostRatio` (prefers cheap abilities
 * over expensive ones).
 */

import { BasePatternDetector } from '../../detector';
import { DetectorRunContext, PatternDetectorMetadata, ShortTermEventRef } from '../../types';

export class ResourceConservationDetector extends BasePatternDetector {
  readonly metadata: PatternDetectorMetadata = {
    id: 'resourceConservation',
    displayName: 'Resource Conservation',
    category: 'decision',
    version: 1,
    description: 'Favors low-cost abilities over expensive ones, conserving resources rather than spending freely.',
  };

  consumeEvent(event: ShortTermEventRef, ctx: DetectorRunContext): void {
    if (event.type !== 'AbilityUsed') return;
    const ratio = event.payload.resourceCostRatio;
    if (typeof ratio !== 'number') return;
    this.observeBinary('conserves-resources', ratio <= ctx.settings.conservingCostRatio, 'Favors low-cost abilities over expensive ones.');
  }
}
