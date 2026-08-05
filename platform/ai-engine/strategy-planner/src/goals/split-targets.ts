import { BaseGoal } from '../goal';
import { GoalEvaluationContext, GoalMetadata } from '../types';

/**
 * Only meaningful for genres with multiple simultaneous targets/threats —
 * reads `PublicGameState.extra.multipleTargets`, the opt-in mechanism
 * documented on `PublicGameState.extra` (types.ts): a plugin that never
 * populates this fact simply never makes this goal eligible, exactly the
 * same "never defaults a missing field to a value" convention Pattern
 * Recognition's detectors already establish for genre-specific payload
 * fields.
 */
export class SplitTargetsGoal extends BaseGoal {
  readonly metadata: GoalMetadata = {
    id: 'splitTargets',
    displayName: 'Split Targets',
    category: 'pressure',
    version: 1,
    interruptPriority: 0,
    description: 'In multi-target genres, force the player to divide attention/resources across more than one simultaneous threat.',
  };

  protected checkPreconditions(ctx: GoalEvaluationContext): boolean {
    return ctx.worldState.extra_multipleTargets === true && ctx.worldState.selfResourcesLow !== true;
  }

  protected computeUtility(ctx: GoalEvaluationContext): { utility: number; reasoning: Record<string, unknown> } {
    const aggressive = ctx.worldState.playerHighAggression === true;
    const utility = 0.4 + (aggressive ? 0.2 : 0);
    return { utility, reasoning: { multipleTargets: true, playerHighAggression: aggressive } };
  }

  protected computeCost(): number {
    return 0.45;
  }

  protected computeEffects(): Record<string, boolean | number> {
    return { playerPressured: true, tempoControlled: true };
  }
}
