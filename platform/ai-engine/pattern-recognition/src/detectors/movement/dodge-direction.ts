/**
 * Preferred Dodge Direction — competing-categorical. Signal: `PlayerMoved`
 * events with `payload.action === 'dodge'` and a `payload.direction` string
 * (e.g. 'left'/'right'/'back'). Tallied once per match via
 * `observeCategorical` so each direction's share is computed against the
 * total dodges this match, not in isolation.
 */

import { BasePatternDetector } from '../../detector';
import { DetectorRunContext, PatternDetectorMetadata, ShortTermEventRef } from '../../types';

export class DodgeDirectionDetector extends BasePatternDetector {
  readonly metadata: PatternDetectorMetadata = {
    id: 'dodgeDirection',
    displayName: 'Preferred Dodge Direction',
    category: 'movement',
    version: 1,
    description: 'Which direction the player dodges toward, relative to their own total dodges.',
  };

  private counts = new Map<string, number>();

  consumeEvent(event: ShortTermEventRef, _ctx: DetectorRunContext): void {
    if (event.type !== 'PlayerMoved') return;
    if (event.payload.action !== 'dodge') return;
    const direction = event.payload.direction;
    if (typeof direction !== 'string') return;
    this.counts.set(direction, (this.counts.get(direction) ?? 0) + 1);
  }

  consumeMatch(_ctx: DetectorRunContext): void {
    this.observeCategorical(this.counts, (direction) => `Dodges toward ${direction} more often than any other direction.`);
  }

  protected override resetAccumulator(): void {
    this.counts = new Map();
  }
}
