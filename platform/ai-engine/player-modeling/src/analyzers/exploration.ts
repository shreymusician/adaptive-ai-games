/**
 * Exploration — whitepaper §3.2/§11: "rate of novel-state visitation ...
 * recommend keeping this per-game only initially." Signal source: the
 * diversity of distinct entities touched via `ItemPicked`/`WeaponEquipped`/
 * `TargetAcquired` events THIS MATCH (distinct entity ids / total such
 * events) — a per-match diversity proxy, not cross-match novelty tracking
 * against full history (which would violate the "no historical
 * recomputation" performance requirement). True novel-state detection
 * against a player's full history is future work — see README "Known
 * limitations".
 */

import { asymptoticConfidence } from '@adaptive-ai/memory-engine';
import { BaseDimensionAnalyzer } from '../analyzer';
import { AnalyzerRunContext, DimensionAnalyzerMetadata, DimensionAnalyzerResult, ShortTermEventRef } from '../types';

const MATCH_CONFIDENCE_K = 6;
const NOVELTY_EVENT_TYPES = new Set(['ItemPicked', 'WeaponEquipped', 'TargetAcquired']);

function entityId(event: ShortTermEventRef): string | undefined {
  const payload = event.payload;
  const candidate = payload.itemId ?? payload.weaponId ?? payload.targetId;
  return typeof candidate === 'string' ? candidate : undefined;
}

export class ExplorationAnalyzer extends BaseDimensionAnalyzer {
  readonly metadata: DimensionAnalyzerMetadata = {
    id: 'exploration',
    displayName: 'Exploration',
    version: 1,
    kind: 'continuous',
    scope: 'per-game',
    description: "This match's diversity ratio: distinct items/weapons/targets touched over total touch events.",
  };

  private distinctEntities: Set<string> = new Set();
  private totalTouches = 0;

  protected resetAccumulator(): void {
    this.distinctEntities = new Set();
    this.totalTouches = 0;
  }

  consumeEvent(event: ShortTermEventRef, _ctx: AnalyzerRunContext): void {
    if (!NOVELTY_EVENT_TYPES.has(event.type)) return;
    this.totalTouches += 1;
    const id = entityId(event);
    if (id !== undefined) this.distinctEntities.add(id);
  }

  consumeMatch(_ctx: AnalyzerRunContext): void {}

  protected deriveResult(): DimensionAnalyzerResult {
    if (this.totalTouches === 0) {
      return { entries: [], matchConfidence: 0, metadata: { totalTouches: 0 } };
    }
    const observation = this.distinctEntities.size / this.totalTouches;
    const matchConfidence = asymptoticConfidence(this.totalTouches, MATCH_CONFIDENCE_K);
    return {
      entries: [{ key: this.metadata.id, observation, sampleCount: this.totalTouches }],
      matchConfidence,
      metadata: { distinctEntities: this.distinctEntities.size, totalTouches: this.totalTouches },
    };
  }
}
