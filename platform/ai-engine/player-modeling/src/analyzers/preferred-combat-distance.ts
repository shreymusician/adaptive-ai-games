/**
 * Preferred Combat Distance — whitepaper §3.2/§11: categorical, "transfers
 * only between plugins that both declare support for a shared distance
 * axis." Signal source: `PlayerDamaged`/`PlayerMoved` events carrying a
 * numeric `payload.distance` (world units, genre-relative), bucketed via
 * `PlayerModelingConfig.combatDistanceBuckets` into close/mid/long. Each
 * bucket is persisted as its own scalar dimension
 * (`preferredCombatDistance:close` etc.) per the categorical-EWMA machinery
 * in analyzer.ts's BaseCategoricalAnalyzer — the "favorite" is `argmax`
 * over those three at read time.
 */

import { BaseCategoricalAnalyzer } from '../analyzer';
import { AnalyzerRunContext, DimensionAnalyzerMetadata, ShortTermEventRef } from '../types';

const DISTANCE_EVENT_TYPES = new Set(['PlayerDamaged', 'PlayerMoved']);

export class PreferredCombatDistanceAnalyzer extends BaseCategoricalAnalyzer {
  readonly metadata: DimensionAnalyzerMetadata = {
    id: 'preferredCombatDistance',
    displayName: 'Preferred Combat Distance',
    version: 1,
    kind: 'categorical',
    scope: 'per-game',
    description: 'Frequency table over close/mid/long combat-distance buckets observed this match.',
  };

  consumeEvent(event: ShortTermEventRef, ctx: AnalyzerRunContext): void {
    if (!DISTANCE_EVENT_TYPES.has(event.type)) return;
    const distance = event.payload.distance;
    if (typeof distance !== 'number') return;
    const { closeMax, midMax } = ctx.settings.combatDistanceBuckets;
    const bucket = distance <= closeMax ? 'close' : distance <= midMax ? 'mid' : 'long';
    this.tally(bucket);
  }
}
