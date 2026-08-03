/**
 * Overextension — fixed-hypothesis binary habit. Signal: `PlayerMoved`
 * events with a numeric `payload.isolationLevel` (0-1, an Influence-Map-
 * style reading of how far the player has moved from support/teammates) —
 * the qualifying opportunity — matched when at/above
 * `PatternRecognitionConfig.overextensionThreshold`.
 */

import { BasePatternDetector } from '../../detector';
import { DetectorRunContext, PatternDetectorMetadata, ShortTermEventRef } from '../../types';

export class OverextensionDetector extends BasePatternDetector {
  readonly metadata: PatternDetectorMetadata = {
    id: 'overextension',
    displayName: 'Overextension',
    category: 'risk',
    version: 1,
    description: 'Moves far from support/teammates more often than staying within a safe range.',
  };

  consumeEvent(event: ShortTermEventRef, ctx: DetectorRunContext): void {
    if (event.type !== 'PlayerMoved') return;
    const isolationLevel = event.payload.isolationLevel;
    if (typeof isolationLevel !== 'number') return;
    this.observeBinary('overextends', isolationLevel >= ctx.settings.overextensionThreshold, 'Moves far from support/teammates more often than staying within a safe range.');
  }
}
