/**
 * computeConfidenceEvolution — tracks how sure the platform has become
 * about ONE claim (a semantic dimension's or a pattern's confidence) over
 * its own stored history. Distinct from BehaviorEvolution: that tracks the
 * dimension's VALUE changing; this tracks the platform's CONFIDENCE in
 * whatever it currently believes changing — e.g. "you now reload earlier"
 * (a pattern's confidence rising through candidate -> confirmed -> strong)
 * is a confidence-evolution story even when the underlying value itself
 * (the reload-timing pattern's descriptive claim) hasn't changed.
 */

import { InsufficientHistoryError } from './errors';
import { evidence, TraceabilityBuilder } from './evidence';
import { ExplainabilityConfig } from './config';
import { confidenceReading } from './confidence';
import { computeTrendDirection } from './behavior-evolution';
import { confidenceEvolutionSentence } from './templates';
import { ConfidenceEvolution, ConfidenceHistoryPoint } from './types';

export function computeConfidenceEvolution(
  history: ConfidenceHistoryPoint[],
  playerId: string,
  subjectKind: 'semanticDimension' | 'pattern',
  subjectId: string,
  now: number,
  config: ExplainabilityConfig
): ConfidenceEvolution {
  if (history.length < 2) throw new InsufficientHistoryError(`${subjectKind} ${subjectId}`, history.length);

  const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const direction = computeTrendDirection(last.confidence - first.confidence, config.trend);

  const firstConfidence = confidenceReading(first.confidence, config.confidenceBuckets);
  const lastConfidence = confidenceReading(last.confidence, config.confidenceBuckets);

  const trace = new TraceabilityBuilder();
  trace.add(
    'trend',
    [
      evidence(subjectKind, `${subjectId}@${first.timestamp}`, subjectId, { confidence: first.confidence, timestamp: first.timestamp }),
      evidence(subjectKind, `${subjectId}@${last.timestamp}`, subjectId, { confidence: last.confidence, timestamp: last.timestamp }),
    ],
    confidenceEvolutionSentence(subjectKind, subjectId, direction, firstConfidence, lastConfidence)
  );
  const { traceability, naturalLanguage } = trace.build();

  return {
    explanationId: `confidence-evolution:${playerId}:${subjectKind}:${subjectId}`,
    playerId,
    subjectKind,
    subjectId,
    generatedAt: now,
    sampleCount: sorted.length,
    firstConfidence,
    lastConfidence,
    direction,
    traceability,
    naturalLanguage,
    schemaVersion: 1,
  };
}
