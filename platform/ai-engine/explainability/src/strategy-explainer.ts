/**
 * explainStrategy — one layer up from a Decision Explanation: "why did the
 * AI decide to pursue THIS goal" (as opposed to "why did it pick THIS
 * action to pursue an already-chosen goal", which is decision-explainer's
 * job). Reads out `StrategicIntent.planningTrace` directly — the chosen
 * candidate's own recorded utility/cost/score plus every eligible-but-not-
 * chosen alternative, exactly as Strategy Planner already computed and
 * stored them. No new judgment is made here.
 */

import { randomUUID } from 'node:crypto';
import { confidenceReading } from './confidence';
import { ExplainabilityConfig } from './config';
import { evidence, TraceabilityBuilder } from './evidence';
import { MalformedPlanningTraceError } from './errors';
import { plannedSequenceSentence, strategyChosenSentence, strategyRejectedSentence } from './templates';
import { StrategicIntent, StrategyExplanation } from './types';

export function explainStrategy(strategicIntent: StrategicIntent, config: ExplainabilityConfig): StrategyExplanation {
  const chosenCandidate = strategicIntent.planningTrace.candidates.find((c) => c.goalId === strategicIntent.goalId);
  if (!chosenCandidate) {
    throw new MalformedPlanningTraceError(strategicIntent.intentId, `no candidate entry for chosen goalId "${strategicIntent.goalId}" in planningTrace.candidates`);
  }

  const rejectedAlternatives = strategicIntent.planningTrace.rejectedEligible;
  const confidence = confidenceReading(strategicIntent.confidence, config.confidenceBuckets);

  const trace = new TraceabilityBuilder();

  trace.add(
    'chosenCandidate',
    [evidence('goal', chosenCandidate.goalId, strategicIntent.goalDisplayName, { utility: chosenCandidate.utility, cost: chosenCandidate.cost, reasoning: chosenCandidate.reasoning })],
    strategyChosenSentence(chosenCandidate.goalId, strategicIntent.category, chosenCandidate.utility, chosenCandidate.cost)
  );

  trace.add(
    'rejectedAlternatives',
    rejectedAlternatives.map((r) => evidence('goal', r.goalId, r.goalId, { score: r.score, utility: r.utility, cost: r.cost })),
    strategyRejectedSentence(rejectedAlternatives.map((r) => ({ goalId: r.goalId, score: r.score })))
  );

  trace.add('plannedSequence', strategicIntent.plannedSequence.map((g) => evidence('goal', g, g, {})), plannedSequenceSentence(strategicIntent.plannedSequence));

  const { traceability, naturalLanguage } = trace.build();

  return {
    explanationId: randomUUID(),
    intentId: strategicIntent.intentId,
    matchId: strategicIntent.matchId,
    playerId: strategicIntent.playerId,
    gameId: strategicIntent.gameId,
    generatedAt: strategicIntent.generatedAt,
    goalId: strategicIntent.goalId,
    goalDisplayName: strategicIntent.goalDisplayName,
    goalCategory: strategicIntent.category,
    personality: strategicIntent.personality,
    plannedSequence: strategicIntent.plannedSequence,
    chosenCandidate,
    rejectedAlternatives,
    confidence,
    awarenessTier: strategicIntent.awarenessUsed.tier,
    awarenessUsed: strategicIntent.awarenessUsed,
    traceability,
    naturalLanguage,
    schemaVersion: 1,
  };
}
