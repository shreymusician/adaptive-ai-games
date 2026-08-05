import { BaseGoal } from '../goal';
import { GoalEvaluationContext, GoalMetadata } from '../types';

export class DenyResourcesGoal extends BaseGoal {
  readonly metadata: GoalMetadata = {
    id: 'denyResources',
    displayName: 'Deny Resources',
    category: 'pressure',
    version: 1,
    interruptPriority: 0,
    description: "Contest pickups/objectives the player relies on, using a known weapon/resource-usage pattern to predict where to deny them.",
  };

  protected checkPreconditions(ctx: GoalEvaluationContext): boolean {
    return ctx.worldState.selfResourcesLow !== true;
  }

  protected computeUtility(ctx: GoalEvaluationContext): { utility: number; reasoning: Record<string, unknown> } {
    const knownCombatPattern = ctx.worldState.patternCategory_combat === true;
    const knownExplorationPattern = ctx.worldState.patternCategory_exploration === true;
    const utility = (knownCombatPattern ? 0.35 : 0.1) + (knownExplorationPattern ? 0.35 : 0);
    return { utility, reasoning: { knownCombatPattern, knownExplorationPattern } };
  }

  protected computeCost(): number {
    return 0.35;
  }

  protected computeEffects(): Record<string, boolean | number> {
    return { playerResourcesLow: true };
  }
}
