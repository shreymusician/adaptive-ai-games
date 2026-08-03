/**
 * Exploration Order — competing-categorical, ONE vote per match. Signal:
 * the first event carrying a `payload.areaId` string this match. Unlike
 * this package's other categorical detectors (which tally every qualifying
 * event), this one casts exactly one vote per match — for the FIRST area
 * visited — so what accumulates over many matches is "which area does this
 * player habitually go to first," not "which area do they spend the most
 * time in."
 *
 * KNOWN LIMITATION: because only one category ever gets an entry per match,
 * this detector's within-match `opportunities`/`matches` batch can never
 * demonstrate a genuine cross-category concentration signal on its own
 * (every recorded match trivially has matches === opportunities for the
 * winning key) — its confidence growth is therefore driven mostly by
 * volume (observationCount), not concentration, until a future enhancement
 * computes concentration as a cross-sibling read at query time instead
 * (comparing one areaId's supportingEvidence against the sum across every
 * areaId under this same detector+player+game — PatternStore.getForPlayer
 * already exposes what that computation would need). See README "Known
 * limitations".
 */

import { BasePatternDetector } from '../../detector';
import { DetectorRunContext, PatternDetectorMetadata, ShortTermEventRef } from '../../types';

export class ExplorationOrderDetector extends BasePatternDetector {
  readonly metadata: PatternDetectorMetadata = {
    id: 'explorationOrder',
    displayName: 'Exploration Order',
    category: 'exploration',
    version: 1,
    description: 'Which area the player visits first, relative to how often any other area was visited first.',
  };

  private firstAreaId: string | null = null;

  consumeEvent(event: ShortTermEventRef, _ctx: DetectorRunContext): void {
    if (this.firstAreaId !== null) return;
    const areaId = event.payload.areaId;
    if (typeof areaId === 'string') this.firstAreaId = areaId;
  }

  consumeMatch(_ctx: DetectorRunContext): void {
    if (this.firstAreaId === null) return;
    this.observeCategorical(new Map([[this.firstAreaId, 1]]), (areaId) => `Visits area "${areaId}" first more often than any other area.`);
  }

  protected override resetAccumulator(): void {
    this.firstAreaId = null;
  }
}
