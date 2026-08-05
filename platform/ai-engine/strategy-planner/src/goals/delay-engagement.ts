import { BaseGoal } from '../goal';
import { GoalEvaluationContext, GoalMetadata } from '../types';

export class DelayEngagementGoal extends BaseGoal {
  readonly metadata: GoalMetadata = {
    id: 'delayEngagement',
    displayName: 'Delay Engagement',
    category: 'tempo',
    version: 1,
    interruptPriority: 2,
    description: "Stall — the AI's own resources are low, or the player is aggressive and no opening exists yet. Buys time for a better tactical window.",
  };

  protected checkPreconditions(ctx: GoalEvaluationContext): boolean {
    const resourcesLow = ctx.worldState.selfResourcesLow === true;
    const aggressiveNoOpening = ctx.worldState.playerHighAggression === true && ctx.worldState.openingAvailable !== true;
    return resourcesLow || aggressiveNoOpening;
  }

  protected computeUtility(ctx: GoalEvaluationContext): { utility: number; reasoning: Record<string, unknown> } {
    const resourcesLow = ctx.worldState.selfResourcesLow === true;
    const aggressive = ctx.worldState.playerHighAggression === true;
    const utility = (resourcesLow ? 0.5 : 0) + (aggressive ? 0.3 : 0);
    return { utility, reasoning: { resourcesLow, playerHighAggression: aggressive } };
  }

  protected computeCost(): number {
    return 0.2;
  }

  protected computeEffects(): Record<string, boolean | number> {
    return { tempoControlled: true, selfResourcesLow: false };
  }
}
