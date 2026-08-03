/**
 * Mechanical Skill — whitepaper §3.2/§11: coarse/generalized execution
 * quality; fine-grained sub-skills stay per-game/per-plugin. Signal source:
 * raw `AbilityUsed` events (a "hit" unless the plugin explicitly flags
 * `payload.hit === false`) against `AbilityOnCooldownAttempt` events (an
 * attempted-but-illegal action — a clean mechanical error signal available
 * generically from the canonical schema, whitepaper §11's requirement for
 * cross-game eligibility).
 */

import { asymptoticConfidence } from '@adaptive-ai/memory-engine';
import { BaseDimensionAnalyzer } from '../analyzer';
import { AnalyzerRunContext, DimensionAnalyzerMetadata, DimensionAnalyzerResult, ShortTermEventRef } from '../types';

const MATCH_CONFIDENCE_K = 8;

export class MechanicalSkillAnalyzer extends BaseDimensionAnalyzer {
  readonly metadata: DimensionAnalyzerMetadata = {
    id: 'mechanicalSkill',
    displayName: 'Mechanical Skill',
    version: 1,
    kind: 'continuous',
    scope: 'per-game',
    description: 'Share of ability attempts this match that landed, penalized by cooldown-violation attempts.',
  };

  private hits = 0;
  private attempts = 0;

  protected resetAccumulator(): void {
    this.hits = 0;
    this.attempts = 0;
  }

  consumeEvent(event: ShortTermEventRef, _ctx: AnalyzerRunContext): void {
    if (event.type === 'AbilityUsed') {
      this.attempts += 1;
      if (event.payload.hit !== false) this.hits += 1;
    } else if (event.type === 'AbilityOnCooldownAttempt') {
      this.attempts += 1;
    }
  }

  consumeMatch(_ctx: AnalyzerRunContext): void {}

  protected deriveResult(): DimensionAnalyzerResult {
    if (this.attempts === 0) {
      return { entries: [], matchConfidence: 0, metadata: { attempts: 0 } };
    }
    const observation = this.hits / this.attempts;
    const matchConfidence = asymptoticConfidence(this.attempts, MATCH_CONFIDENCE_K);
    return {
      entries: [{ key: this.metadata.id, observation, sampleCount: this.attempts }],
      matchConfidence,
      metadata: { hits: this.hits, attempts: this.attempts },
    };
  }
}
