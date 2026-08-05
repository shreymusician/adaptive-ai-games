import { BaseGoal } from '../goal';
import { GoalEvaluationContext, GoalMetadata } from '../types';

export class ForceMovementGoal extends BaseGoal {
  readonly metadata: GoalMetadata = {
    id: 'forceMovement',
    displayName: 'Force Movement',
    category: 'positioning',
    version: 1,
    interruptPriority: 0,
    description: 'Contest space or threaten the objective to compel the player to reposition, surfacing predictable movement patterns.',
  };

  protected checkPreconditions(ctx: GoalEvaluationContext): boolean {
    return ctx.worldState.spaceContested === true || ctx.worldState.objectiveThreatened === true;
  }

  protected computeUtility(ctx: GoalEvaluationContext): { utility: number; reasoning: Record<string, unknown> } {
    const contested = typeof ctx.worldState.spaceContestedValue === 'number' ? ctx.worldState.spaceContestedValue : 0.5;
    const knownMovementPattern = ctx.worldState.patternCategory_movement === true;
    const utility = contested * 0.6 + (knownMovementPattern ? 0.25 : 0);
    return { utility, reasoning: { spaceContestedValue: contested, knownMovementPattern } };
  }

  protected computeCost(): number {
    return 0.3;
  }

  protected computeEffects(): Record<string, boolean | number> {
    return { playerRepositioned: true, spaceContested: false };
  }
}
