import { BaseGoal } from '../goal';
import { GoalEvaluationContext, GoalMetadata } from '../types';
import { clamp } from '../stats';

export class PressurePlayerGoal extends BaseGoal {
  readonly metadata: GoalMetadata = {
    id: 'pressurePlayer',
    displayName: 'Pressure Player',
    category: 'pressure',
    version: 1,
    interruptPriority: 0,
    description: 'Press an existing tactical opening, or capitalize on the player being visibly weakened.',
  };

  protected checkPreconditions(ctx: GoalEvaluationContext): boolean {
    return ctx.worldState.openingAvailable === true || ctx.worldState.playerHealthLow === true;
  }

  protected computeUtility(ctx: GoalEvaluationContext): { utility: number; reasoning: Record<string, unknown> } {
    const opening = ctx.worldState.openingAvailable === true;
    const weakened = ctx.worldState.playerHealthLow === true;
    const lowSkill = ctx.worldState.playerLowMechanicalSkill === true;
    let utility = (opening ? 0.5 : 0) + (weakened ? 0.35 : 0) + (lowSkill ? 0.15 : 0);
    utility = clamp(utility);
    return { utility, reasoning: { openingAvailable: opening, playerHealthLow: weakened, playerLowMechanicalSkill: lowSkill } };
  }

  protected computeCost(ctx: GoalEvaluationContext): number {
    return ctx.worldState.selfResourcesLow === true ? 0.6 : 0.35;
  }

  protected computeEffects(): Record<string, boolean | number> {
    return { playerPressured: true, spaceContested: true, openingAvailable: false };
  }
}
