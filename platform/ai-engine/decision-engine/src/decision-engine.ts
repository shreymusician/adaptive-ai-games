/**
 * DecisionEngine — the top-level orchestrator:
 *
 *   Validate StrategicIntent + legal actions -> Mask inputs by Awareness
 *   Budget -> Build DecisionWorldFacts -> Evaluate every legal action
 *   (DecisionRegistry -> Utility Scorers, weighted by personality) ->
 *   Select the winner (deterministic tie-break / seeded exploration) ->
 *   Decision
 *
 * This class contains no gameplay logic of its own. It never invents an
 * action, never talks to a plugin, never mutates game state — it only
 * scores and selects among the `legalActions` it was given, exactly the
 * way `StrategyPlanner` sequences its own five modules with no AI logic of
 * its own.
 */

import { randomUUID } from 'node:crypto';
import { isAction } from '@adaptive-ai/sdk-protocol';
import { GoalCategory, isPersonalityArchetype } from '@adaptive-ai/strategy-planner';
import { DecisionRegistry } from './registry';
import { DecisionEngineConfig } from './config';
import { Logger, rootLogger } from './logger';
import { createAwarenessAccumulator, freezeAwarenessUsed, maskDecisionInputs } from './awareness-budget';
import { buildWorldFacts } from './world-facts';
import { evaluateAction } from './evaluator';
import { selectBestAction } from './selector';
import { resolvePersonalityWeight } from './personality';
import { InvalidStrategicIntentError, MalformedLegalActionsError, NoLegalActionsError } from './errors';
import { Action, ActionScore, Decision, DecisionInputs, DecisionMetadata, ReasoningTrace } from './types';
import { clamp } from './stats';

export interface DecisionEngineOptions {
  registry: DecisionRegistry;
  config: DecisionEngineConfig;
  logger?: Logger;
}

const VALID_GOAL_CATEGORIES: GoalCategory[] = ['pressure', 'positioning', 'deception', 'information', 'defense', 'tempo'];

function validateStrategicIntent(intent: DecisionInputs['strategicIntent']): void {
  if (!intent || typeof intent.goalId !== 'string' || intent.goalId.length === 0) {
    throw new InvalidStrategicIntentError('goalId is missing or empty');
  }
  if (!VALID_GOAL_CATEGORIES.includes(intent.category)) {
    throw new InvalidStrategicIntentError(`category "${intent.category}" is not a recognized goal category`);
  }
  if (typeof intent.confidence !== 'number' || intent.confidence < 0 || intent.confidence > 1) {
    throw new InvalidStrategicIntentError(`confidence must be a number in [0,1], got ${String(intent.confidence)}`);
  }
}

/** Validates and filters `legalActions` against the real SDK `Action` shape — never trusts a plugin's output at face value. Returns the valid subset plus a count of how many entries were dropped. */
function validateLegalActions(raw: unknown, matchId: string): { valid: Action[]; skippedMalformed: number } {
  if (!Array.isArray(raw)) {
    throw new MalformedLegalActionsError(matchId, `expected an array, got ${typeof raw}`);
  }
  const valid = raw.filter(isAction);
  return { valid, skippedMalformed: raw.length - valid.length };
}

function computeConfidence(scores: ActionScore[], selected: ActionScore): number {
  if (scores.length === 1) return clamp(0.5 + selected.utility / 2);
  const ranked = [...scores].sort((a, b) => b.utility - a.utility);
  const top = ranked[0];
  const runnerUp = ranked.find((s) => s.action.id !== selected.action.id) ?? ranked[1];
  const gap = Math.abs(top.utility - runnerUp.utility);
  const denom = top.utility + runnerUp.utility + 1e-6;
  return clamp(gap / denom);
}

export class DecisionEngine {
  private readonly registry: DecisionRegistry;
  private readonly config: DecisionEngineConfig;
  private readonly logger: Logger;

  constructor(options: DecisionEngineOptions) {
    this.registry = options.registry;
    this.config = options.config;
    this.logger = (options.logger ?? rootLogger).child({ component: 'decision-engine' });
  }

  decide(inputs: DecisionInputs, now: number = Date.now()): Decision {
    const start = Date.now();

    validateStrategicIntent(inputs.strategicIntent);
    if (!isPersonalityArchetype(inputs.personality)) {
      throw new InvalidStrategicIntentError(`personality "${String(inputs.personality)}" is not a recognized archetype`);
    }

    const matchId = inputs.matchContext.matchId;
    const { valid: legalActions, skippedMalformed } = validateLegalActions(inputs.legalActions, matchId);
    if (legalActions.length === 0) {
      throw new NoLegalActionsError(matchId);
    }

    const { masked, tier } = maskDecisionInputs(inputs, this.config.awarenessBudget);
    const acc = createAwarenessAccumulator(tier, inputs.awarenessBudget, masked);
    const worldFacts = buildWorldFacts(masked, this.config.worldFactThresholds);

    const scores: ActionScore[] = [];
    let timedOut = false;
    for (const action of legalActions) {
      if (Date.now() - start > this.config.maxEvaluationMs) {
        timedOut = true;
        this.logger.warn('Decision evaluation budget exceeded — selecting among actions scored so far', {
          matchId,
          actionsConsidered: scores.length,
          actionsRemaining: legalActions.length - scores.length,
        });
        break;
      }
      scores.push(evaluateAction(this.registry, action, now, masked, worldFacts, acc, inputs.personality, this.config, this.logger));
    }

    // The wall-clock guard can only fire between actions, never before the
    // first — so `scores` is never empty here (legalActions.length >= 1
    // was already guaranteed above, and the first iteration always runs).
    const seed = `${matchId}:${inputs.matchContext.elapsedMs}:${now}`;
    const { selected, alternatives, tieBreak } = selectBestAction(scores, inputs.personality, this.config.personality, seed);
    const confidence = computeConfidence(scores, selected);

    const rankedForTrace = [...scores].sort((a, b) => b.utility - a.utility);
    const tracedCount = Math.min(this.config.maxTracedActions, rankedForTrace.length);
    const perActionBreakdown = rankedForTrace.slice(0, tracedCount).map((s) => ({ actionId: s.action.id, utility: s.utility, considerations: s.breakdown }));

    const considerationWeights: Record<string, number> = {};
    for (const meta of this.registry.list()) {
      considerationWeights[meta.id] = resolvePersonalityWeight(this.config.personality, inputs.personality, meta);
    }

    const metadata: DecisionMetadata = {
      engineVersion: this.config.engineVersion,
      actionsConsidered: scores.length,
      actionsSkippedMalformed: skippedMalformed,
      evaluationDurationMs: Date.now() - start,
      timedOut,
      tieBreak,
      awarenessTier: tier,
      personality: inputs.personality,
    };

    const reasoningTrace: ReasoningTrace = {
      strategicIntentGoalId: inputs.strategicIntent.goalId,
      worldFacts,
      considerationWeights,
      perActionBreakdown,
      perActionBreakdownTruncated: rankedForTrace.length > tracedCount,
      awarenessUsed: freezeAwarenessUsed(acc),
    };

    const decision: Decision = {
      decisionId: randomUUID(),
      matchId,
      playerId: inputs.matchContext.playerId,
      gameId: inputs.matchContext.gameId,
      action: selected.action,
      score: { utility: selected.utility, confidence, breakdown: selected.breakdown },
      alternatives,
      metadata,
      reasoningTrace,
      executionTimestamp: now,
    };

    this.logger.info('Decision made', {
      matchId,
      actionId: selected.action.id,
      utility: selected.utility,
      confidence,
      tieBreak,
      timedOut,
      actionsConsidered: scores.length,
    });

    return decision;
  }
}
