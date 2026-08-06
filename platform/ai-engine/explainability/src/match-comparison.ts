/**
 * compareMatches — "Compared to your previous matches..." Diffs two already
 * -generated MatchSummaries plus the player's semantic-profile snapshots
 * taken at each match, entirely from stored data (whitepaper §8 comparison
 * mandate: "All comparisons must come from stored memory"). Every
 * dimension delta is only reported for a dimension present in BOTH
 * snapshots — a dimension observed in only one is never guessed at for the
 * other.
 */

import { evidence, TraceabilityBuilder } from './evidence';
import { ExplainabilityConfig } from './config';
import { computeTrendDirection } from './behavior-evolution';
import { decisionCountDeltaSentence, dimensionComparisonSentence } from './templates';
import { DimensionComparison, MatchComparison, MatchSummary, SemanticProfileEntry } from './types';

export function compareMatches(before: MatchSummary, after: MatchSummary, dimensionsBefore: SemanticProfileEntry[], dimensionsAfter: SemanticProfileEntry[], now: number, config: ExplainabilityConfig): MatchComparison {
  const beforeByDim = new Map(dimensionsBefore.map((d) => [d.dimension, d]));
  const afterByDim = new Map(dimensionsAfter.map((d) => [d.dimension, d]));
  const sharedDimensions = [...beforeByDim.keys()].filter((d) => afterByDim.has(d)).sort();

  const dimensionDeltas: DimensionComparison[] = sharedDimensions.map((dimension) => {
    const b = beforeByDim.get(dimension)!.value;
    const a = afterByDim.get(dimension)!.value;
    const delta = a - b;
    return { dimension, before: b, after: a, delta, direction: computeTrendDirection(delta, config.trend) };
  });

  const decisionCountDelta = after.decisionCount - before.decisionCount;
  const averageUtilityDelta = after.averageUtility - before.averageUtility;
  const personalityChanged = before.personality !== null && after.personality !== null && before.personality !== after.personality;

  const trace = new TraceabilityBuilder();
  for (const d of dimensionDeltas) {
    trace.add(
      `dimensionDeltas.${d.dimension}`,
      [
        evidence('semanticDimension', `${d.dimension}:before`, d.dimension, { matchId: before.matchId, value: d.before }),
        evidence('semanticDimension', `${d.dimension}:after`, d.dimension, { matchId: after.matchId, value: d.after }),
      ],
      dimensionComparisonSentence(d.dimension, d.before, d.after, d.direction)
    );
  }
  trace.add(
    'decisionCountDelta',
    [
      evidence('alternativeAction', `${before.matchId}:decisionCount`, before.matchId, { decisionCount: before.decisionCount }),
      evidence('alternativeAction', `${after.matchId}:decisionCount`, after.matchId, { decisionCount: after.decisionCount }),
    ],
    decisionCountDeltaSentence(decisionCountDelta)
  );

  const { traceability, naturalLanguage } = trace.build();

  return {
    explanationId: `match-comparison:${before.matchId}:${after.matchId}`,
    playerId: after.playerId,
    generatedAt: now,
    beforeMatchId: before.matchId,
    afterMatchId: after.matchId,
    dimensionDeltas,
    decisionCountDelta,
    averageUtilityDelta,
    personalityChanged,
    traceability,
    naturalLanguage,
    schemaVersion: 1,
  };
}
