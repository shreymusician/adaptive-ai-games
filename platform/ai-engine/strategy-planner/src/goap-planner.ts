/**
 * Bounded GOAP forward search — ADAPTIVE_AI_ENGINE_WHITEPAPER.md §6:
 * "GOAP-style forward search, bounded depth, over a small ABSTRACT action
 * space." The "actions" here are the registered Goals themselves — each
 * step of the plan picks one goal, applies its declared `expectedEffects`
 * to simulate the resulting AbstractWorldState, and re-evaluates every goal
 * against that new state for the next step.
 *
 * Bounded on every axis the whitepaper requires:
 *   - Depth:        config.goap.maxSearchDepth (default 3)
 *   - Beam width:   config.goap.beamWidth (default 3) — only the top-K
 *                    scoring eligible goals are expanded further at each level
 *   - Node budget:  config.goap.nodeBudget (default 60) — total individual
 *                    goal evaluations across the whole search, the actual
 *                    computational bound (whitepaper §12.11)
 *
 * Deterministic: goal iteration order comes from GoalRegistry's stable
 * executionOrder(); score ties break on goalId (string) ascending; the only
 * source of randomness anywhere (Experimental personality's exploration
 * term) is a seeded pseudo-random function of caller-supplied inputs, never
 * wall-clock or Math.random().
 */

import { GoalRegistry } from './registry';
import { StrategyPlannerConfig } from './config';
import { resolvePersonalityWeight, explorationEpsilon, seededUnitRandom } from './personality';
import { applyEffects } from './world-state';
import { AbstractWorldState, GoalCandidateTrace, GoalEvaluationContext, PlanStepTrace, PersonalityArchetype } from './types';
import { Logger } from './logger';

export interface GoapSearchResult {
  planSequence: PlanStepTrace[];
  rootCandidates: GoalCandidateTrace[];
  rejectedEligible: GoalCandidateTrace[];
  nodesExpanded: number;
  searchDepthUsed: number;
}

interface ScoredCandidate extends GoalCandidateTrace {
  expectedEffects: AbstractWorldState;
}

function scoreCandidates(
  registry: GoalRegistry,
  baseCtx: Omit<GoalEvaluationContext, 'siblingResults' | 'worldState'>,
  worldState: AbstractWorldState,
  personality: PersonalityArchetype,
  config: StrategyPlannerConfig,
  logger?: Logger
): { eligible: ScoredCandidate[]; all: GoalCandidateTrace[] } {
  const { results } = registry.evaluateAll({ ...baseCtx, worldState }, logger);
  const all: GoalCandidateTrace[] = [];
  const eligible: ScoredCandidate[] = [];

  for (const [goalId, result] of results) {
    const meta = registry.get(goalId)!;
    const personalityWeight = resolvePersonalityWeight(config.personality, personality, meta);
    const score = personalityWeight * result.utility - result.cost;
    const trace: GoalCandidateTrace = {
      goalId,
      utility: result.utility,
      cost: result.cost,
      personalityWeight,
      score,
      preconditionsMet: result.preconditionsMet,
      reasoning: result.reasoning,
    };
    all.push(trace);
    if (result.preconditionsMet) {
      eligible.push({ ...trace, expectedEffects: result.expectedEffects });
    }
  }

  // Deterministic ordering: score descending, goalId ascending as tiebreak.
  eligible.sort((a, b) => b.score - a.score || a.goalId.localeCompare(b.goalId));
  all.sort((a, b) => b.score - a.score || a.goalId.localeCompare(b.goalId));

  return { eligible: applyInterruptOverride(eligible, registry), all };
}

/**
 * Goal interruption (whitepaper-adjacent extension for this phase): a goal
 * with a positive `interruptPriority` (e.g. Retreat, ProtectObjective)
 * represents an urgent, safety/objective-critical situation, not just
 * "another option to weigh." Ordinary personality-weighted utility scoring
 * alone cannot be trusted to surface these — an Aggressive personality
 * deliberately deweights the `defense` category, which would otherwise let
 * a merely-attractive offensive goal outscore a genuinely urgent Retreat.
 *
 * When one or more eligible candidates have `interruptPriority > 0`, this
 * restricts consideration to only the HIGHEST such priority among them
 * (ties broken by score, then goalId, same as normal) — an urgent goal
 * always wins outright over any non-urgent one, and among multiple urgent
 * goals, the more urgent one wins. Goals with `interruptPriority === 0`
 * (every goal in this phase except Retreat/ProtectObjective/DelayEngagement)
 * are completely unaffected by this and continue to compete purely on score.
 */
function applyInterruptOverride(eligible: ScoredCandidate[], registry: GoalRegistry): ScoredCandidate[] {
  const urgent = eligible.filter((c) => (registry.get(c.goalId)?.interruptPriority ?? 0) > 0);
  if (urgent.length === 0) return eligible;
  const maxPriority = Math.max(...urgent.map((c) => registry.get(c.goalId)!.interruptPriority));
  return urgent.filter((c) => registry.get(c.goalId)!.interruptPriority === maxPriority);
}

interface SearchNode {
  path: ScoredCandidate[];
  cumulativeScore: number;
}

export function runGoapSearch(
  registry: GoalRegistry,
  baseCtx: Omit<GoalEvaluationContext, 'siblingResults' | 'worldState'>,
  initialWorldState: AbstractWorldState,
  personality: PersonalityArchetype,
  config: StrategyPlannerConfig,
  seed: string,
  logger?: Logger
): GoapSearchResult {
  const { goap } = config;
  const goalCount = registry.list().length;
  let nodesExpanded = 0;

  const { eligible: rootEligible, all: rootAll } = scoreCandidates(registry, baseCtx, initialWorldState, personality, config, logger);
  nodesExpanded += goalCount;

  function expand(worldState: AbstractWorldState, depth: number, path: ScoredCandidate[], cumulativeScore: number): SearchNode {
    if (depth >= goap.maxSearchDepth || nodesExpanded + goalCount > goap.nodeBudget) {
      return { path, cumulativeScore };
    }

    const { eligible } = depth === 0 ? { eligible: rootEligible } : scoreCandidates(registry, baseCtx, worldState, personality, config, logger);
    if (depth !== 0) nodesExpanded += goalCount;

    if (eligible.length === 0) {
      return { path, cumulativeScore };
    }

    // Experimental personality: with probability epsilon, deliberately
    // explore a lower-scored eligible candidate instead of the top one —
    // deterministic given `seed`, never Math.random().
    const epsilon = explorationEpsilon(config.personality, personality);
    const roll = epsilon > 0 ? seededUnitRandom(`${seed}:${depth}`) : 1;
    const beam = eligible.slice(0, Math.max(1, goap.beamWidth));
    if (epsilon > 0 && roll < epsilon && beam.length > 1) {
      // Rotate the beam so a non-top candidate leads exploration at this depth.
      const exploreIndex = 1 + (Math.abs(hashToInt(seed + depth)) % (beam.length - 1));
      const [picked] = beam.splice(exploreIndex, 1);
      beam.unshift(picked);
    }

    let best: SearchNode | null = null;
    const discount = Math.pow(goap.discountFactor, depth);

    for (const candidate of beam) {
      const nextState = applyEffects(worldState, candidate.expectedEffects);
      const child = expand(nextState, depth + 1, [...path, candidate], cumulativeScore + candidate.score * discount);
      if (best === null || child.cumulativeScore > best.cumulativeScore) best = child;
    }

    return best ?? { path, cumulativeScore };
  }

  const rootResult = expand(initialWorldState, 0, [], 0);

  const planSequence: PlanStepTrace[] = [];
  let stateWalker = initialWorldState;
  for (const step of rootResult.path) {
    planSequence.push({ goalId: step.goalId, worldStateBefore: stateWalker, expectedEffects: step.expectedEffects, score: step.score });
    stateWalker = applyEffects(stateWalker, step.expectedEffects);
  }

  return {
    planSequence,
    rootCandidates: rootAll,
    rejectedEligible: rootAll.filter((c) => c.preconditionsMet && c.goalId !== (planSequence[0]?.goalId ?? '')),
    nodesExpanded,
    searchDepthUsed: planSequence.length,
  };
}

function hashToInt(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}
