/**
 * Aggression — whitepaper §3.2: "weighted rate of offense-initiating events
 * vs. total events, normalized per genre." Signal source: raw canonical
 * events this match — `AbilityUsed` (counted as offensive unless the
 * plugin explicitly flags `payload.offensive === false`) and
 * `TargetAcquired` (engaging a target is inherently offense-oriented),
 * against the total of all target/ability-related action events.
 */

import { asymptoticConfidence } from '@adaptive-ai/memory-engine';
import { BaseDimensionAnalyzer } from '../analyzer';
import { AnalyzerRunContext, DimensionAnalyzerMetadata, DimensionAnalyzerResult, ShortTermEventRef } from '../types';

const MATCH_CONFIDENCE_K = 8;
const ACTION_EVENT_TYPES = new Set(['AbilityUsed', 'TargetAcquired', 'TargetSwitched']);

export class AggressionAnalyzer extends BaseDimensionAnalyzer {
  readonly metadata: DimensionAnalyzerMetadata = {
    id: 'aggression',
    displayName: 'Aggression',
    version: 1,
    kind: 'continuous',
    scope: 'per-game',
    description: "Share of this match's action events that were offense-initiating.",
  };

  private offenseEvents = 0;
  private totalActionEvents = 0;

  protected resetAccumulator(): void {
    this.offenseEvents = 0;
    this.totalActionEvents = 0;
  }

  consumeEvent(event: ShortTermEventRef, _ctx: AnalyzerRunContext): void {
    if (!ACTION_EVENT_TYPES.has(event.type)) return;
    this.totalActionEvents += 1;
    if (event.type === 'TargetAcquired') {
      this.offenseEvents += 1;
      return;
    }
    if (event.type === 'AbilityUsed' && event.payload.offensive !== false) {
      this.offenseEvents += 1;
    }
  }

  consumeMatch(_ctx: AnalyzerRunContext): void {}

  protected deriveResult(): DimensionAnalyzerResult {
    if (this.totalActionEvents === 0) {
      return { entries: [], matchConfidence: 0, metadata: { totalActionEvents: 0 } };
    }
    const observation = this.offenseEvents / this.totalActionEvents;
    const matchConfidence = asymptoticConfidence(this.totalActionEvents, MATCH_CONFIDENCE_K);
    return {
      entries: [{ key: this.metadata.id, observation, sampleCount: this.totalActionEvents }],
      matchConfidence,
      metadata: { offenseEvents: this.offenseEvents, totalActionEvents: this.totalActionEvents },
    };
  }
}
