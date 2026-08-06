/**
 * explainPattern — whitepaper §8's "pattern-level" tier: "I noticed you
 * always dodge left." A near-direct readout of one trusted Pattern
 * Recognition entry, minimal templating required. Takes the PatternEntry
 * directly — there is no awareness-gating decision to make here, because
 * calling this function on a specific pattern already implies the caller
 * has independently verified that pattern is visible at the current
 * Awareness Budget tier (the same responsibility decision-explainer
 * discharges internally via AwarenessUsed for patterns that fed an actual
 * decision).
 */

import { randomUUID } from 'node:crypto';
import { confidenceReading } from './confidence';
import { ExplainabilityConfig } from './config';
import { evidence, TraceabilityBuilder } from './evidence';
import { patternReadoutSentence } from './templates';
import { PatternExplanation, PatternEntry } from './types';

export function explainPattern(pattern: PatternEntry, playerId: string, gameId: string, now: number, config: ExplainabilityConfig): PatternExplanation {
  const confidence = confidenceReading(pattern.confidence, config.confidenceBuckets);

  const trace = new TraceabilityBuilder();
  trace.add(
    'pattern',
    [evidence('pattern', pattern.patternId, pattern.description, { category: pattern.category, state: pattern.state, detectorId: pattern.detectorId })],
    patternReadoutSentence(pattern.description, pattern.category, pattern.state, confidence)
  );

  const { traceability, naturalLanguage } = trace.build();

  return {
    explanationId: randomUUID(),
    playerId,
    gameId,
    generatedAt: now,
    patternId: pattern.patternId,
    category: pattern.category,
    description: pattern.description,
    state: pattern.state,
    confidence,
    traceability,
    naturalLanguage,
    schemaVersion: 1,
  };
}
