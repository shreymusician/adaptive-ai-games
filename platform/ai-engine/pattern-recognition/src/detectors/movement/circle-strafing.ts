/**
 * Circle Strafing — fixed-hypothesis binary habit. Signal: `PlayerMoved`
 * events during combat (`payload.inCombat === true`) — the qualifying
 * opportunity — matched when `payload.strafing === true`.
 */

import { BasePatternDetector } from '../../detector';
import { DetectorRunContext, PatternDetectorMetadata, ShortTermEventRef } from '../../types';

export class CircleStrafingDetector extends BasePatternDetector {
  readonly metadata: PatternDetectorMetadata = {
    id: 'circleStrafing',
    displayName: 'Circle Strafing',
    category: 'movement',
    version: 1,
    description: 'Circles around targets while engaged in combat rather than standing still or approaching directly.',
  };

  consumeEvent(event: ShortTermEventRef, _ctx: DetectorRunContext): void {
    if (event.type !== 'PlayerMoved') return;
    if (event.payload.inCombat !== true) return;
    this.observeBinary('circle-strafes', event.payload.strafing === true, 'Circles around targets while in combat.');
  }
}
