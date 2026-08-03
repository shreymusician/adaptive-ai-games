/**
 * Chase Low-Health Enemies — fixed-hypothesis binary habit. Signal: every
 * `TargetAcquired` event with a numeric `payload.targetHealthPercent` is a
 * qualifying opportunity; matched when that value is at/below
 * `PatternRecognitionConfig.lowHealthThreshold` — i.e. this acquisition
 * targeted an already-weakened enemy.
 */

import { BasePatternDetector } from '../../detector';
import { DetectorRunContext, PatternDetectorMetadata, ShortTermEventRef } from '../../types';

export class ChaseLowHealthDetector extends BasePatternDetector {
  readonly metadata: PatternDetectorMetadata = {
    id: 'chaseLowHealth',
    displayName: 'Chase Low-Health Enemies',
    category: 'risk',
    version: 1,
    description: 'Targets already-weakened enemies more often than healthy ones.',
  };

  consumeEvent(event: ShortTermEventRef, ctx: DetectorRunContext): void {
    if (event.type !== 'TargetAcquired') return;
    const healthPercent = event.payload.targetHealthPercent;
    if (typeof healthPercent !== 'number') return;
    this.observeBinary('chases-low-health', healthPercent <= ctx.settings.lowHealthThreshold, 'Targets already-weakened enemies more often than healthy ones.');
  }
}
