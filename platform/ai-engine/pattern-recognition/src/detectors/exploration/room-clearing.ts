/**
 * Room Clearing Behavior — fixed-hypothesis binary habit. Signal: any
 * event carrying `payload.roomFullyCleared` (a boolean the plugin sets when
 * the player leaves a room) — the qualifying opportunity — matched when
 * `true` (clears every threat/item before moving on) vs `false` (moves on
 * while the room still has unresolved threats/items).
 */

import { BasePatternDetector } from '../../detector';
import { DetectorRunContext, PatternDetectorMetadata, ShortTermEventRef } from '../../types';

export class RoomClearingDetector extends BasePatternDetector {
  readonly metadata: PatternDetectorMetadata = {
    id: 'roomClearingBehavior',
    displayName: 'Room Clearing Behavior',
    category: 'exploration',
    version: 1,
    description: 'Fully clears a room of threats/items before moving on, rather than leaving things unresolved.',
  };

  consumeEvent(event: ShortTermEventRef, _ctx: DetectorRunContext): void {
    const cleared = event.payload.roomFullyCleared;
    if (typeof cleared !== 'boolean') return;
    this.observeBinary('fully-clears-rooms', cleared, 'Fully clears a room before moving on.');
  }
}
