import { BaseGoal } from '../goal';
import { GoalEvaluationContext, GoalMetadata } from '../types';

export class ForceReloadGoal extends BaseGoal {
  readonly metadata: GoalMetadata = {
    id: 'forceReload',
    displayName: 'Force Reload',
    category: 'tempo',
    version: 1,
    interruptPriority: 0,
    description: "Bait the player's aggression to burn their own resources, creating a future opening once they're forced to reload/recover.",
  };

  protected checkPreconditions(ctx: GoalEvaluationContext): boolean {
    return ctx.worldState.selfResourcesLow !== true && (ctx.worldState.playerHighAggression === true || ctx.worldState.patternCategory_combat === true);
  }

  protected computeUtility(ctx: GoalEvaluationContext): { utility: number; reasoning: Record<string, unknown> } {
    const aggressive = ctx.worldState.playerHighAggression === true;
    const knownCombatPattern = ctx.worldState.patternCategory_combat === true;
    const utility = (aggressive ? 0.45 : 0) + (knownCombatPattern ? 0.35 : 0);
    return { utility, reasoning: { playerHighAggression: aggressive, knownCombatPattern } };
  }

  protected computeCost(): number {
    return 0.25;
  }

  protected computeEffects(): Record<string, boolean | number> {
    return { playerResourcesLow: true, openingAvailable: true };
  }
}
