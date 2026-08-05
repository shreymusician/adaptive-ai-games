import { BaseGoal } from '../goal';
import { GoalEvaluationContext, GoalMetadata } from '../types';

export class ControlSpaceGoal extends BaseGoal {
  readonly metadata: GoalMetadata = {
    id: 'controlSpace',
    displayName: 'Control Space',
    category: 'positioning',
    version: 1,
    interruptPriority: 0,
    description: 'Claim and hold contested space outright, rather than merely forcing the player through it.',
  };

  protected checkPreconditions(ctx: GoalEvaluationContext): boolean {
    return ctx.worldState.spaceContested === true;
  }

  protected computeUtility(ctx: GoalEvaluationContext): { utility: number; reasoning: Record<string, unknown> } {
    const contested = typeof ctx.worldState.spaceContestedValue === 'number' ? ctx.worldState.spaceContestedValue : 0.5;
    return { utility: contested * 0.7, reasoning: { spaceContestedValue: contested } };
  }

  protected computeCost(ctx: GoalEvaluationContext): number {
    return ctx.worldState.selfHealthLow === true ? 0.7 : 0.4;
  }

  protected computeEffects(): Record<string, boolean | number> {
    return { spaceContested: false, territoryControlled: true };
  }
}
