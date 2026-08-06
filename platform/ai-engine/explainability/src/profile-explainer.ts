/**
 * explainPlayerProfile — a direct readout of one or more Semantic Profile
 * dimensions (whitepaper §3). Like pattern-explainer, the caller is
 * responsible for having already selected which dimensions are legal to
 * surface at the current Awareness Budget tier — this function reads out
 * exactly the entries it's given, nothing more.
 */

import { randomUUID } from 'node:crypto';
import { confidenceReading } from './confidence';
import { ExplainabilityConfig } from './config';
import { evidence, TraceabilityBuilder } from './evidence';
import { profileDimensionSentence } from './templates';
import { PlayerProfileExplanation, SemanticProfileEntry } from './types';

export function explainPlayerProfile(dimensions: SemanticProfileEntry[], playerId: string, now: number, config: ExplainabilityConfig): PlayerProfileExplanation {
  const trace = new TraceabilityBuilder();
  const readout = dimensions.map((d) => {
    const confidence = confidenceReading(d.confidence, config.confidenceBuckets);
    trace.add(
      `dimensions.${d.dimension}`,
      [evidence('semanticDimension', d.dimension, d.dimension, { gameId: d.gameId, value: d.value, samples: d.samples })],
      profileDimensionSentence(d.dimension, d.value, confidence, d.samples)
    );
    return { dimension: d.dimension, gameId: d.gameId, value: d.value, confidence, samples: d.samples };
  });

  const { traceability, naturalLanguage } = trace.build();

  return {
    explanationId: randomUUID(),
    playerId,
    generatedAt: now,
    dimensions: readout,
    traceability,
    naturalLanguage,
    schemaVersion: 1,
  };
}
