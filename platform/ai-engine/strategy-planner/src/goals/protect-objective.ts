import { BaseGoal } from '../goal';
import { GoalEvaluationContext, GoalMetadata } from '../types';

export class ProtectObjectiveGoal extends BaseGoal {
  readonly metadata: GoalMetadata = {
    id: 'protectObjective',
    displayName: 'Protect Objective',
    category: 'defense',
    version: 1,
    interruptPriority: 5,
    description: 'The plugin reports a live objective under threat — prioritize defending it over any offensive plan in progress.',
  };

  protected checkPreconditions(ctx: GoalEvaluationContext): boolean {
    return ctx.worldState.objectiveThreatened === true;
  }

  protected computeUtility(): { utility: number; reasoning: Record<string, unknown> } {
    // Objective loss is a hard, publicly-visible failure state — this is
    // urgent enough to be near-maximal utility whenever it applies at all.
    return { utility: 0.9, reasoning: { objectiveThreatened: true } };
  }

  protected computeCost(): number {
    return 0.3;
  }

  protected computeEffects(): Record<string, boolean | number> {
    return { objectiveThreatened: false };
  }
}
