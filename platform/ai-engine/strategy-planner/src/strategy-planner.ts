/**
 * StrategyPlanner — the top-level orchestrator:
 *
 *   Mask inputs by Awareness Budget -> Build AbstractWorldState ->
 *   Check plan cache (incremental replanning / invalidation / interruption) ->
 *   [cache miss] Bounded GOAP search over the Goal Registry -> StrategicIntent
 *
 * This class performs NO gameplay logic. It never selects a legal action,
 * never talks to a plugin, never mutates game state — its only output is
 * StrategicIntent, an abstract goal for a future Decision Engine to
 * translate into real actions (explicitly out of scope for this phase).
 */

import { randomUUID } from 'node:crypto';
import { GoalRegistry } from './registry';
import { StrategyPlannerConfig } from './config';
import { Logger, rootLogger } from './logger';
import { createAwarenessAccumulator, freezeAwarenessUsed, maskPlanningInputs } from './awareness-budget';
import { buildWorldState } from './world-state';
import { runGoapSearch } from './goap-planner';
import { CachedPlanEntry, PlanCache, checkCacheValidity, eligibleInterruptGoalIds, findInterruptingGoal, fingerprintWorldState } from './plan-cache';
import { GoalCandidateTrace, PlanningInputs, PlanningMetadata, PlanningTrace, StrategicIntent } from './types';
import { clamp } from './stats';

export interface StrategyPlannerOptions {
  registry: GoalRegistry;
  config: StrategyPlannerConfig;
  planCache?: PlanCache;
  logger?: Logger;
}

function computeConfidence(rootCandidates: GoalCandidateTrace[], chosenGoalId: string): number {
  const eligible = [...rootCandidates].filter((c) => c.preconditionsMet).sort((a, b) => b.score - a.score);
  if (eligible.length === 0) return 0;
  const top = eligible.find((c) => c.goalId === chosenGoalId) ?? eligible[0];
  if (eligible.length === 1) return clamp(0.5 + top.score / 2);
  const runnerUp = eligible.find((c) => c.goalId !== top.goalId) ?? eligible[1];
  const gap = top.score - runnerUp.score;
  const denom = Math.abs(top.score) + Math.abs(runnerUp.score) + 1e-6;
  return clamp(gap / denom);
}

export class StrategyPlanner {
  private readonly registry: GoalRegistry;
  private readonly config: StrategyPlannerConfig;
  private readonly planCache: PlanCache;
  private readonly logger: Logger;

  constructor(options: StrategyPlannerOptions) {
    this.registry = options.registry;
    this.config = options.config;
    this.planCache = options.planCache ?? new PlanCache();
    this.logger = (options.logger ?? rootLogger).child({ component: 'strategy-planner' });
  }

  /** Test/ops helper — forces the next plan() call for a match to fully replan, bypassing any otherwise-still-valid cache entry. */
  invalidate(matchId: string): boolean {
    return this.planCache.invalidate(matchId);
  }

  plan(inputs: PlanningInputs, now: number = Date.now()): StrategicIntent {
    const start = Date.now();
    const matchId = inputs.matchContext.matchId;

    const { masked, tier } = maskPlanningInputs(inputs, this.config.awarenessBudget);
    const acc = createAwarenessAccumulator(tier, inputs.awarenessBudget, masked);
    const worldState = buildWorldState(masked, acc, this.config);
    const worldStateFingerprint = fingerprintWorldState(worldState);

    const cached = this.planCache.get(matchId);

    // A single root-level candidate pass, used both to decide whether an
    // interrupt-priority goal preempts an otherwise-valid cache entry, and
    // (on a cache miss) as the trace's `candidates`/`rejectedEligible` data.
    const baseCtx = { inputs: masked as unknown as PlanningInputs, worldState, awarenessUsed: acc, siblingResults: new Map() };
    const rootPeek = this.registry.evaluateAll(baseCtx, this.logger);
    const rootCandidatesPeek: GoalCandidateTrace[] = [...rootPeek.results.entries()].map(([goalId, result]) => ({
      goalId,
      utility: result.utility,
      cost: result.cost,
      personalityWeight: 1,
      score: result.utility - result.cost, // unweighted peek, used only for interruption detection — the real scored/weighted pass happens inside runGoapSearch
      preconditionsMet: result.preconditionsMet,
      reasoning: result.reasoning,
    }));

    const previouslyEligibleInterruptIds = new Set(cached?.eligibleInterruptGoalIds ?? []);
    const interruptingGoalId = cached ? findInterruptingGoal(this.registry, rootCandidatesPeek, previouslyEligibleInterruptIds) : null;
    const cacheValidity = cached ? checkCacheValidity(cached, now, worldStateFingerprint, inputs.awarenessBudget, inputs.personality, this.config.goap.planTtlMs) : null;

    if (cached && cacheValidity?.valid && interruptingGoalId === null) {
      const durationMs = Date.now() - start;
      const intent: StrategicIntent = {
        ...cached.intent,
        planningMetadata: { ...cached.intent.planningMetadata, cacheHit: true, replanned: false, interruptedGoalId: null, planningDurationMs: durationMs },
      };
      this.logger.debug('Plan cache hit', { matchId, goalId: intent.goalId });
      return intent;
    }

    // Reported whenever an interrupt-worthy goal newly became eligible
    // since the cached plan was created, regardless of whether the world
    // state ALSO changed for some other reason (it usually did — the
    // interrupting goal's own precondition is itself part of the world
    // state). This is "why did we replan" metadata, not exclusively tied
    // to the narrower "cache was otherwise still valid" case.
    const interruptedGoalId = cached && interruptingGoalId ? cached.intent.goalId : null;

    const seed = `${matchId}:${inputs.matchContext.elapsedMs}:${now}`;
    const searchResult = runGoapSearch(
      this.registry,
      { inputs: masked as unknown as PlanningInputs, awarenessUsed: acc },
      worldState,
      inputs.personality,
      this.config,
      seed,
      this.logger
    );

    if (searchResult.planSequence.length === 0) {
      // Guarded by RegroupGoal's always-true preconditions in normal
      // operation — this branch only fires if a caller registered a
      // registry without any always-eligible fallback goal.
      this.logger.error('GOAP search produced no eligible goal — no fallback goal is registered', { matchId });
    }

    const chosenGoalId = searchResult.planSequence[0]?.goalId ?? 'regroup';
    const chosenMeta = this.registry.get(chosenGoalId);
    const plannedSequence = searchResult.planSequence.slice(1).map((s) => s.goalId);

    const trace: PlanningTrace = {
      worldState,
      candidates: searchResult.rootCandidates,
      planSequence: searchResult.planSequence,
      rejectedEligible: searchResult.rejectedEligible,
    };

    const planningMetadata: PlanningMetadata = {
      plannerVersion: this.config.plannerVersion,
      searchDepthUsed: searchResult.searchDepthUsed,
      maxSearchDepth: this.config.goap.maxSearchDepth,
      nodesExpanded: searchResult.nodesExpanded,
      nodeBudget: this.config.goap.nodeBudget,
      beamWidth: this.config.goap.beamWidth,
      cacheHit: false,
      replanned: true,
      interruptedGoalId,
      candidateCount: searchResult.rootCandidates.length,
      planningDurationMs: Date.now() - start,
    };

    const intent: StrategicIntent = {
      intentId: randomUUID(),
      matchId,
      playerId: inputs.matchContext.playerId,
      gameId: inputs.matchContext.gameId,
      goalId: chosenGoalId,
      goalDisplayName: chosenMeta?.displayName ?? chosenGoalId,
      category: chosenMeta?.category ?? 'defense',
      confidence: computeConfidence(searchResult.rootCandidates, chosenGoalId),
      plannedSequence,
      personality: inputs.personality,
      awarenessBudget: inputs.awarenessBudget,
      awarenessUsed: freezeAwarenessUsed(acc),
      planningMetadata,
      planningTrace: trace,
      generatedAt: now,
      validUntil: now + this.config.goap.planTtlMs,
    };

    const entry: CachedPlanEntry = {
      intent,
      worldStateFingerprint,
      awarenessBudget: inputs.awarenessBudget,
      personality: inputs.personality,
      createdAt: now,
      eligibleInterruptGoalIds: eligibleInterruptGoalIds(this.registry, searchResult.rootCandidates),
    };
    this.planCache.set(matchId, entry);

    this.logger.info('Plan generated', { matchId, goalId: chosenGoalId, confidence: intent.confidence, replanned: true, interruptedGoalId });

    return intent;
  }
}
