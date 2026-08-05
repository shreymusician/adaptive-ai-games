import { BaseGoal } from '../goal';
import { GoalEvaluationContext, GoalMetadata } from '../types';

export class CreateAmbushGoal extends BaseGoal {
  readonly metadata: GoalMetadata = {
    id: 'createAmbush',
    displayName: 'Create Ambush',
    category: 'deception',
    version: 1,
    interruptPriority: 0,
    description: 'Exploit a known movement/route pattern to set up a surprise opening, rather than a direct confrontation.',
  };

  protected checkPreconditions(ctx: GoalEvaluationContext): boolean {
    return ctx.worldState.hasExploitablePattern === true && ctx.worldState.playerRetreating !== true;
  }

  protected computeUtility(ctx: GoalEvaluationContext): { utility: number; reasoning: Record<string, unknown> } {
    const movementKnown = ctx.worldState.patternCategory_movement === true;
    const count = typeof ctx.worldState.exploitablePatternCount === 'number' ? ctx.worldState.exploitablePatternCount : 0;
    const utility = (movementKnown ? 0.5 : 0.2) + Math.min(count, 3) * 0.08;
    return { utility, reasoning: { movementKnown, exploitablePatternCount: count } };
  }

  protected computeCost(): number {
    return 0.4;
  }

  protected computeEffects(): Record<string, boolean | number> {
    return { playerSurprised: true, openingAvailable: true };
  }
}
