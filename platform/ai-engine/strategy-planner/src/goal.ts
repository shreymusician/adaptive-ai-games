/**
 * The standard interface every Goal implements — the abstract "action
 * space" the GOAP planner searches over (whitepaper §6: "a small ABSTRACT
 * action space {pressure, regroup, flank, bait, defend, ...}"). Each Goal
 * is a fully independent module: it only ever reads GoalEvaluationContext,
 * never another goal's internals directly (only its already-computed
 * GoalEvaluationResult, via siblingResults, and only if declared in
 * `dependsOn`).
 *
 * Lifecycle — called once per goal, per planning-search node (i.e. up to
 * `nodeBudget` times per StrategyPlanner.plan() call, not once per call):
 *   metadata()  — static descriptor, readable any time
 *   evaluate(ctx) — pure: derive this goal's utility/cost/preconditions/effects
 *     from the given context. No I/O, no mutation, no randomness (Experimental
 *     personality's exploration term lives in the planner, never inside a goal).
 */

import { GoalEvaluationContext, GoalEvaluationResult, GoalMetadata } from './types';

export interface Goal {
  readonly metadata: GoalMetadata;
  evaluate(ctx: GoalEvaluationContext): GoalEvaluationResult;
}

export type GoalFactory = () => Goal;

/**
 * Shared plumbing: clamps utility/cost into [0,1] and fills in
 * `preconditionsMet`/`expectedEffects` defaults so a goal file only ever
 * implements `checkPreconditions`/`computeUtility`/`computeCost`/
 * `computeEffects` — never the boilerplate around them. Optional to extend;
 * a goal may implement `Goal` directly if it needs full control (none of
 * the fourteen goals in this phase do).
 */
export abstract class BaseGoal implements Goal {
  abstract readonly metadata: GoalMetadata;

  protected abstract checkPreconditions(ctx: GoalEvaluationContext): boolean;
  protected abstract computeUtility(ctx: GoalEvaluationContext): { utility: number; reasoning: Record<string, unknown> };
  protected abstract computeCost(ctx: GoalEvaluationContext): number;
  protected abstract computeEffects(ctx: GoalEvaluationContext): Record<string, boolean | number>;

  evaluate(ctx: GoalEvaluationContext): GoalEvaluationResult {
    const preconditionsMet = this.checkPreconditions(ctx);
    if (!preconditionsMet) {
      return {
        goalId: this.metadata.id,
        utility: 0,
        cost: 1,
        preconditionsMet: false,
        expectedEffects: {},
        reasoning: { skipped: 'preconditions not met' },
      };
    }
    const { utility, reasoning } = this.computeUtility(ctx);
    const cost = this.computeCost(ctx);
    const expectedEffects = this.computeEffects(ctx);
    return {
      goalId: this.metadata.id,
      utility: Math.min(1, Math.max(0, utility)),
      cost: Math.min(1, Math.max(0, cost)),
      preconditionsMet: true,
      expectedEffects: Object.freeze(expectedEffects),
      reasoning,
    };
  }
}
