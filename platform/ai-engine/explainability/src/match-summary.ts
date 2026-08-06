/**
 * summarizeMatch — aggregates every DecisionExplanation already generated
 * for one match into a single MatchSummary. Pure over the supplied array:
 * this function never queries a store itself (the ExplanationStore/
 * ExplainabilityEngine layer is responsible for fetching "every
 * DecisionExplanation for match X" and handing the array in) — same
 * "pure core, store-backed orchestration on top" split every other
 * AI-engine package in this monorepo already follows.
 */

import { confidenceReading } from './confidence';
import { ExplainabilityConfig } from './config';
import { EmptyDecisionSetError, InconsistentMatchDataError } from './errors';
import { evidence, TraceabilityBuilder } from './evidence';
import { goalBreakdownSentence, keyMomentsSentence, matchOverviewSentence } from './templates';
import { DecisionExplanation, DecisionSummaryRef, GoalCategory, GoalCategoryTally, MatchSummary, PersonalityArchetype } from './types';

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function toRef(e: DecisionExplanation): DecisionSummaryRef {
  return { decisionId: e.decisionId, actionId: e.summary.actionId, goalId: e.summary.goalId, utility: e.summary.utility, confidence: e.confidence };
}

export function summarizeMatch(explanations: DecisionExplanation[], matchId: string, now: number, config: ExplainabilityConfig): MatchSummary {
  if (explanations.length === 0) throw new EmptyDecisionSetError(matchId);
  for (const e of explanations) {
    if (e.matchId !== matchId) throw new InconsistentMatchDataError(matchId, e.matchId, e.decisionId);
  }

  const playerId = explanations[0].playerId;
  const gameId = explanations[0].gameId;

  const personalities = new Set(explanations.map((e) => e.summary.personality));
  const personality: PersonalityArchetype | null = personalities.size === 1 ? [...personalities][0] : null;

  const averageUtility = mean(explanations.map((e) => e.summary.utility));
  const averageConfidence = confidenceReading(mean(explanations.map((e) => e.confidence.value)), config.confidenceBuckets);

  const categoryTallies = new Map<GoalCategory, number>();
  for (const e of explanations) categoryTallies.set(e.summary.goalCategory, (categoryTallies.get(e.summary.goalCategory) ?? 0) + 1);
  const goalCategoryBreakdown: GoalCategoryTally[] = [...categoryTallies.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => a.category.localeCompare(b.category));

  const distinctPatternsUsed = [...new Set(explanations.flatMap((e) => e.patternsUsed.map((p) => p.patternId)))].sort();
  const distinctTraitsUsed = [...new Set(explanations.flatMap((e) => e.playerTraitsUsed.map((t) => t.dimension)))].sort();
  const distinctMemoriesReferenced = [...new Set(explanations.flatMap((e) => e.memoriesReferenced.map((m) => m.episodeId)))].sort();

  const byConfidenceAsc = [...explanations].sort((a, b) => a.confidence.value - b.confidence.value || a.decisionId.localeCompare(b.decisionId));
  const closestCalls = byConfidenceAsc.slice(0, config.maxKeyMoments).map(toRef);
  const mostDecisive = [...byConfidenceAsc].reverse().slice(0, config.maxKeyMoments).map(toRef);

  const trace = new TraceabilityBuilder();
  trace.add(
    'overview',
    explanations.map((e) => evidence('alternativeAction', e.decisionId, e.summary.actionId, { utility: e.summary.utility })),
    matchOverviewSentence(explanations.length, personality, averageUtility, averageConfidence)
  );
  trace.add('goalCategoryBreakdown', goalCategoryBreakdown.map((b) => evidence('goal', b.category, b.category, { count: b.count })), goalBreakdownSentence(goalCategoryBreakdown));
  trace.add('closestCalls', closestCalls.map((c) => evidence('alternativeAction', c.decisionId, c.actionId, { utility: c.utility })), keyMomentsSentence('closest calls', closestCalls));
  trace.add('mostDecisive', mostDecisive.map((m) => evidence('alternativeAction', m.decisionId, m.actionId, { utility: m.utility })), keyMomentsSentence('most decisive plays', mostDecisive));

  const { traceability, naturalLanguage } = trace.build();

  return {
    explanationId: `match-summary:${matchId}`,
    matchId,
    playerId,
    gameId,
    generatedAt: now,
    decisionCount: explanations.length,
    personality,
    averageUtility,
    averageConfidence,
    goalCategoryBreakdown,
    distinctPatternsUsed,
    distinctTraitsUsed,
    distinctMemoriesReferenced,
    closestCalls,
    mostDecisive,
    traceability,
    naturalLanguage,
    schemaVersion: 1,
  };
}
