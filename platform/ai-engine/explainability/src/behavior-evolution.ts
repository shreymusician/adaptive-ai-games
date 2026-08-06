/**
 * computeBehaviorEvolution — "Compared to your previous matches, you have
 * become more aggressive." Reads a dimension's stored version history
 * directly from Memory Engine's SemanticDimensionVersion collection (the
 * caller fetches it via SemanticMemoryStore.getHistory and hands the array
 * in — this function itself never touches a database, same "pure core"
 * convention as every other explainer here). All comparisons come from
 * stored memory, never inference (whitepaper §8 comparison-support mandate).
 */

import { InsufficientHistoryError } from './errors';
import { evidence, TraceabilityBuilder } from './evidence';
import { ExplainabilityConfig, TrendConfig } from './config';
import { behaviorEvolutionSentence } from './templates';
import { BehaviorEvolution, SemanticDimensionVersion, TrendDirection } from './types';

export function computeTrendDirection(delta: number, trend: TrendConfig): TrendDirection {
  if (Math.abs(delta) < trend.stableEpsilon) return 'stable';
  return delta > 0 ? 'increasing' : 'decreasing';
}

export function computeBehaviorEvolution(history: SemanticDimensionVersion[], playerId: string, dimension: string, now: number, config: ExplainabilityConfig): BehaviorEvolution {
  if (history.length < 2) throw new InsufficientHistoryError(`${playerId}/${dimension}`, history.length);

  const sorted = [...history].sort((a, b) => a.version - b.version);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const delta = last.value - first.value;
  const direction = computeTrendDirection(delta, config.trend);

  const trace = new TraceabilityBuilder();
  trace.add(
    'trend',
    [
      evidence('semanticDimension', `${dimension}@v${first.version}`, dimension, { value: first.value, updatedAt: first.updatedAt }),
      evidence('semanticDimension', `${dimension}@v${last.version}`, dimension, { value: last.value, updatedAt: last.updatedAt }),
    ],
    behaviorEvolutionSentence(dimension, direction, first.value, last.value, sorted.length)
  );
  const { traceability, naturalLanguage } = trace.build();

  return {
    explanationId: `behavior-evolution:${playerId}:${first.gameId ?? 'cross-game'}:${dimension}`,
    playerId,
    gameId: first.gameId,
    dimension,
    generatedAt: now,
    sampleCount: sorted.length,
    firstValue: first.value,
    lastValue: last.value,
    delta,
    direction,
    firstObservedAt: first.updatedAt,
    lastObservedAt: last.updatedAt,
    traceability,
    naturalLanguage,
    schemaVersion: 1,
  };
}
