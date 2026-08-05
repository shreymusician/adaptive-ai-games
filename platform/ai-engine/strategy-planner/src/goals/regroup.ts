/**
 * Regroup — the guaranteed-eligible fallback goal. Preconditions are
 * trivially always true, so the registry (and therefore the GOAP planner)
 * always has at least one eligible candidate, even when every other goal's
 * preconditions fail — this is what lets StrategyPlanner.plan() never throw
 * NoEligibleGoalError as long as this goal stays registered. A safe,
 * low-commitment default: reposition to a stable baseline stance.
 */

import { BaseGoal } from '../goal';
import { GoalEvaluationContext, GoalMetadata } from '../types';

export class RegroupGoal extends BaseGoal {
  readonly metadata: GoalMetadata = {
    id: 'regroup',
    displayName: 'Regroup',
    category: 'defense',
    version: 1,
    interruptPriority: 0,
    description: 'Fall back to a stable, low-commitment baseline stance. Always eligible — the safe default when nothing else applies.',
  };

  protected checkPreconditions(): boolean {
    return true;
  }

  protected computeUtility(ctx: GoalEvaluationContext): { utility: number; reasoning: Record<string, unknown> } {
    const health = ctx.worldState.selfHealthLow === true;
    const resources = ctx.worldState.selfResourcesLow === true;
    // A mild baseline utility, boosted slightly when the AI itself isn't in
    // great shape — but never as urgent as Retreat, which is what actually
    // handles a genuinely dangerous situation.
    const utility = 0.25 + (health ? 0.1 : 0) + (resources ? 0.1 : 0);
    return { utility, reasoning: { selfHealthLow: health, selfResourcesLow: resources, baseline: 0.25 } };
  }

  protected computeCost(): number {
    return 0.1;
  }

  protected computeEffects(): Record<string, boolean | number> {
    return { aiRepositioned: true, selfResourcesLow: false };
  }
}
