/**
 * explainDecision — the core, most load-bearing function in this package:
 * `Decision` + `StrategicIntent` + the caller's full known context
 * (semantic profile / patterns / episodes) -> `DecisionExplanation`.
 *
 * Truthfulness (whitepaper §8) is enforced structurally, not by
 * convention: patternsUsed/playerTraitsUsed/memoriesReferenced are built
 * ONLY by iterating `AwarenessUsed`'s own recorded "actually read" id
 * lists (never by scanning the caller's full context for anything that
 * merely LOOKS relevant) — an id genuinely gated by the Awareness Budget
 * was never added to those lists in the first place (see
 * @adaptive-ai/decision-engine's awareness-budget.ts / readPatterns /
 * readSemanticDimension), so it structurally cannot appear here. If an id
 * IS recorded as read but the caller's supplied context doesn't contain a
 * matching entry, that's a genuine data-integrity gap upstream — this
 * function refuses to fabricate a stand-in and throws
 * MissingReasoningDataError instead (see errors.ts doc comment).
 */

import { randomUUID } from 'node:crypto';
import { confidenceReading } from './confidence';
import { ExplainabilityConfig } from './config';
import { evidence, TraceabilityBuilder } from './evidence';
import { IntentDecisionMismatchError, MalformedDecisionTraceError, MissingReasoningDataError } from './errors';
import {
  alternativesSentence,
  awarenessTierSentence,
  confidenceSentence,
  decisionSummarySentence,
  memoriesReferencedSentence,
  patternsUsedSentence,
  playerTraitsSentence,
  primaryReasonSentence,
  supportingEvidenceSentence,
} from './templates';
import { AlternativeConsidered, ConsiderationResult, Decision, DecisionExplanation, MemoryReferenced, PatternUsed, PlayerTraitUsed, StrategicIntent } from './types';
import { ExplanationInputs } from './types';

function resolveWinningBreakdown(decision: Decision): ConsiderationResult[] {
  const breakdown = decision.score.breakdown;
  if (breakdown.length === 0) {
    throw new MalformedDecisionTraceError(decision.decisionId, 'score.breakdown is empty — no consideration was ever evaluated for the winning action');
  }
  return breakdown;
}

function rankByContribution(breakdown: ConsiderationResult[], weights: Record<string, number>): Array<ConsiderationResult & { weight: number; contribution: number }> {
  const withContribution = breakdown.map((c) => {
    const weight = weights[c.considerationId] ?? 0;
    return { ...c, weight, contribution: weight * c.value };
  });
  return [...withContribution].sort((a, b) => b.contribution - a.contribution || a.considerationId.localeCompare(b.considerationId));
}

function resolvePatternsUsed(decision: Decision, patterns: ExplanationInputs['patterns'], config: ExplainabilityConfig): PatternUsed[] {
  return decision.reasoningTrace.awarenessUsed.patternIdsRead.map((patternId) => {
    const found = patterns.find((p) => p.patternId === patternId);
    if (!found) throw new MissingReasoningDataError('pattern', patternId, `decision ${decision.decisionId}`);
    return {
      patternId: found.patternId,
      category: found.category,
      description: found.description,
      confidence: confidenceReading(found.confidence, config.confidenceBuckets),
      state: found.state,
    };
  });
}

function resolvePlayerTraitsUsed(decision: Decision, semanticProfile: ExplanationInputs['semanticProfile'], strategicIntent: StrategicIntent, config: ExplainabilityConfig): PlayerTraitUsed[] {
  return decision.reasoningTrace.awarenessUsed.semanticDimensionsRead.map((dimension) => {
    const candidates = semanticProfile.filter((d) => d.dimension === dimension);
    const found = candidates.find((d) => d.gameId === strategicIntent.gameId) ?? candidates.find((d) => d.gameId === null) ?? candidates[0];
    if (!found) throw new MissingReasoningDataError('semanticDimension', dimension, `decision ${decision.decisionId}`);
    return {
      dimension: found.dimension,
      value: found.value,
      confidence: confidenceReading(found.confidence, config.confidenceBuckets),
      samples: found.samples,
    };
  });
}

function resolveMemoriesReferenced(strategicIntent: StrategicIntent, episodes: ExplanationInputs['episodes'], config: ExplainabilityConfig): MemoryReferenced[] {
  return strategicIntent.awarenessUsed.episodeIdsRead.map((episodeId) => {
    const found = episodes.find((e) => e.episodeId === episodeId);
    if (!found) throw new MissingReasoningDataError('episode', episodeId, `strategicIntent ${strategicIntent.intentId}`);
    return {
      episodeId: found.episodeId,
      episodeType: found.episodeType,
      summary: found.summary,
      importance: found.importance,
      confidence: confidenceReading(found.confidence, config.confidenceBuckets),
      timestamp: found.timestamp,
    };
  });
}

export function explainDecision(inputs: ExplanationInputs, config: ExplainabilityConfig): DecisionExplanation {
  const { decision, strategicIntent } = inputs;

  if (decision.reasoningTrace.strategicIntentGoalId !== strategicIntent.goalId) {
    throw new IntentDecisionMismatchError(decision.reasoningTrace.strategicIntentGoalId, strategicIntent.goalId);
  }

  const winningBreakdown = resolveWinningBreakdown(decision);
  const ranked = rankByContribution(winningBreakdown, decision.reasoningTrace.considerationWeights);
  const [primary, ...rest] = ranked;

  const patternsUsed = resolvePatternsUsed(decision, inputs.patterns, config);
  const playerTraitsUsed = resolvePlayerTraitsUsed(decision, inputs.semanticProfile, strategicIntent, config);
  const memoriesReferenced = resolveMemoriesReferenced(strategicIntent, inputs.episodes, config);

  const winnerUtility = decision.score.utility;
  const alternativesConsidered: AlternativeConsidered[] = decision.alternatives
    .filter((a) => a.rank > 1)
    .map((a) => ({ actionId: a.actionId, utility: a.utility, rank: a.rank, utilityGapFromWinner: winnerUtility - a.utility }));

  const confidence = confidenceReading(decision.score.confidence, config.confidenceBuckets);

  const trace = new TraceabilityBuilder();

  trace.add(
    'summary',
    [
      evidence('goal', strategicIntent.goalId, strategicIntent.goalDisplayName, { category: strategicIntent.category }),
      evidence('alternativeAction', decision.action.id, decision.action.id, { utility: winnerUtility }),
    ],
    decisionSummarySentence(decision.action.id, strategicIntent.goalDisplayName, strategicIntent.category, winnerUtility)
  );

  trace.add(
    'primaryReason',
    [evidence('consideration', primary.considerationId, primary.considerationId, { weight: primary.weight, value: primary.value, reasoning: primary.reasoning })],
    primaryReasonSentence(primary.considerationId, primary.weight, primary.value, primary.contribution)
  );

  trace.add(
    'supportingEvidence',
    rest.map((r) => evidence('consideration', r.considerationId, r.considerationId, { weight: r.weight, value: r.value, reasoning: r.reasoning })),
    supportingEvidenceSentence(rest)
  );

  trace.add(
    'alternativesConsidered',
    alternativesConsidered.map((a) => evidence('alternativeAction', a.actionId, a.actionId, { utility: a.utility, rank: a.rank })),
    alternativesSentence(alternativesConsidered)
  );

  trace.add(
    'patternsUsed',
    patternsUsed.map((p) => evidence('pattern', p.patternId, p.description, { category: p.category, state: p.state, confidence: p.confidence })),
    patternsUsedSentence(patternsUsed)
  );

  trace.add(
    'playerTraitsUsed',
    playerTraitsUsed.map((t) => evidence('semanticDimension', t.dimension, t.dimension, { value: t.value, confidence: t.confidence })),
    playerTraitsSentence(playerTraitsUsed)
  );

  trace.add(
    'memoriesReferenced',
    memoriesReferenced.map((m) => evidence('episode', m.episodeId, m.summary, { episodeType: m.episodeType, importance: m.importance })),
    memoriesReferencedSentence(memoriesReferenced)
  );

  trace.add('confidence', [evidence('worldFact', 'decision.score.confidence', 'decision.score.confidence', { value: decision.score.confidence })], confidenceSentence(confidence));

  trace.add('awarenessTier', [evidence('worldFact', 'decision.metadata.awarenessTier', 'decision.metadata.awarenessTier', { tier: decision.metadata.awarenessTier })], awarenessTierSentence(decision.metadata.awarenessTier));

  const { traceability, naturalLanguage } = trace.build();

  return {
    explanationId: randomUUID(),
    decisionId: decision.decisionId,
    matchId: decision.matchId,
    playerId: decision.playerId,
    gameId: decision.gameId,
    generatedAt: decision.executionTimestamp,
    summary: {
      actionId: decision.action.id,
      goalId: strategicIntent.goalId,
      goalDisplayName: strategicIntent.goalDisplayName,
      goalCategory: strategicIntent.category,
      personality: decision.metadata.personality,
      utility: winnerUtility,
    },
    primaryReason: { considerationId: primary.considerationId, considerationWeight: primary.weight, considerationValue: primary.value, contribution: primary.contribution, reasoning: primary.reasoning },
    supportingEvidence: rest.map((r) => ({ considerationId: r.considerationId, considerationWeight: r.weight, considerationValue: r.value, contribution: r.contribution, reasoning: r.reasoning })),
    alternativesConsidered,
    patternsUsed,
    playerTraitsUsed,
    memoriesReferenced,
    confidence,
    awarenessTier: decision.metadata.awarenessTier,
    worldFacts: decision.reasoningTrace.worldFacts,
    traceability,
    naturalLanguage,
    schemaVersion: 1,
  };
}
