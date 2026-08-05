/**
 * Retreat — the emergency interrupt goal. Highest interruptPriority of any
 * goal in this phase: when the AI's own public health drops low, this goal
 * must be able to preempt an in-progress cached plan immediately (see
 * plan-cache.ts's interruption rule), regardless of what multi-step plan
 * was previously committed to.
 */

import { BaseGoal } from '../goal';
import { GoalEvaluationContext, GoalMetadata } from '../types';
import { clamp } from '../stats';

export class RetreatGoal extends BaseGoal {
  readonly metadata: GoalMetadata = {
    id: 'retreat',
    displayName: 'Retreat',
    category: 'defense',
    version: 1,
    interruptPriority: 10,
    description: "Disengage immediately — the AI's own public health/integrity has dropped below a safe threshold.",
  };

  protected checkPreconditions(ctx: GoalEvaluationContext): boolean {
    return ctx.worldState.selfHealthLow === true;
  }

  protected computeUtility(ctx: GoalEvaluationContext): { utility: number; reasoning: Record<string, unknown> } {
    const selfHealth = typeof ctx.worldState.selfHealth === 'number' ? ctx.worldState.selfHealth : 0;
    // Scales inversely with health — the lower the health, the more urgent.
    const utility = clamp(1 - selfHealth, 0.6, 1);
    return { utility, reasoning: { selfHealth, urgent: true } };
  }

  protected computeCost(): number {
    // Retreating is cheap by design — safety should never be the expensive option.
    return 0.15;
  }

  protected computeEffects(): Record<string, boolean | number> {
    return { selfHealthLow: false, aiRepositioned: true, spaceContested: false };
  }
}
