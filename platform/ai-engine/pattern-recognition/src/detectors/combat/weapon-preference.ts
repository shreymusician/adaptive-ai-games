/**
 * Weapon Preference — competing-categorical. Signal: `WeaponEquipped`
 * events with a `payload.weaponId` string.
 */

import { BasePatternDetector } from '../../detector';
import { DetectorRunContext, PatternDetectorMetadata, ShortTermEventRef } from '../../types';

export class WeaponPreferenceDetector extends BasePatternDetector {
  readonly metadata: PatternDetectorMetadata = {
    id: 'weaponPreference',
    displayName: 'Weapon Preference',
    category: 'combat',
    version: 1,
    description: 'Which weapon the player equips most often, relative to their own total weapon-equip events.',
  };

  private counts = new Map<string, number>();

  consumeEvent(event: ShortTermEventRef, _ctx: DetectorRunContext): void {
    if (event.type !== 'WeaponEquipped') return;
    const weaponId = event.payload.weaponId;
    if (typeof weaponId !== 'string') return;
    this.counts.set(weaponId, (this.counts.get(weaponId) ?? 0) + 1);
  }

  consumeMatch(_ctx: DetectorRunContext): void {
    this.observeCategorical(this.counts, (weaponId) => `Equips "${weaponId}" more often than any other weapon.`);
  }

  protected override resetAccumulator(): void {
    this.counts = new Map();
  }
}
