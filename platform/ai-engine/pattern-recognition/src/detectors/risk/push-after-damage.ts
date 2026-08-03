/**
 * Push After Damage — fixed-hypothesis binary habit. Signal: every
 * `PlayerDamaged` event is a qualifying opportunity; matched when an
 * offensive follow-up (`AbilityUsed` with `payload.offensive !== false`, or
 * `TargetAcquired`) appears within
 * `PatternRecognitionConfig.pushAfterDamageWindowEvents` events afterward,
 * in the SAME match's event log — i.e. reacts to taking damage by pressing
 * the attack rather than disengaging. Requires look-ahead over the match's
 * full event list, so this is computed in `consumeMatch` rather than
 * per-event.
 */

import { BasePatternDetector } from '../../detector';
import { DetectorRunContext, PatternDetectorMetadata, ShortTermEventRef } from '../../types';

function isAggressiveFollowUp(event: ShortTermEventRef): boolean {
  if (event.type === 'TargetAcquired') return true;
  return event.type === 'AbilityUsed' && event.payload.offensive !== false;
}

export class PushAfterDamageDetector extends BasePatternDetector {
  readonly metadata: PatternDetectorMetadata = {
    id: 'pushAfterDamage',
    displayName: 'Push After Damage',
    category: 'risk',
    version: 1,
    description: 'Responds to taking damage by pressing the attack rather than disengaging.',
  };

  consumeEvent(_event: ShortTermEventRef, _ctx: DetectorRunContext): void {}

  consumeMatch(ctx: DetectorRunContext): void {
    const events = ctx.match.recentEvents;
    const window = ctx.settings.pushAfterDamageWindowEvents;
    for (let i = 0; i < events.length; i++) {
      if (events[i].type !== 'PlayerDamaged') continue;
      const followUp = events.slice(i + 1, i + 1 + window).some(isAggressiveFollowUp);
      this.observeBinary('pushes-after-damage', followUp, 'Presses the attack after taking damage rather than disengaging.');
    }
  }
}
