import { BaseGoal } from '../goal';
import { GoalEvaluationContext, GoalMetadata } from '../types';

/**
 * Targets the PLAYER's own predictability (whitepaper §3.2's Predictability
 * dimension, and §5's confirmed patterns) — deliberately punishing a
 * repeated habit until the player is forced to genuinely vary their play,
 * distinct from CreateAmbush (which exploits a pattern once for a single
 * opening) — this goal aims at making the pattern stop being safe to repeat.
 */
export class BreakPredictablePatternGoal extends BaseGoal {
  readonly metadata: GoalMetadata = {
    id: 'breakPredictablePattern',
    displayName: 'Break Predictable Pattern',
    category: 'deception',
    version: 1,
    interruptPriority: 0,
    description: "Repeatedly punish the player's most predictable confirmed habit until repeating it stops being safe.",
  };

  protected checkPreconditions(ctx: GoalEvaluationContext): boolean {
    return ctx.worldState.playerPredictable === true || ctx.worldState.hasExploitablePattern === true;
  }

  protected computeUtility(ctx: GoalEvaluationContext): { utility: number; reasoning: Record<string, unknown> } {
    const predictable = ctx.worldState.playerPredictable === true;
    const patternBacked = ctx.worldState.hasExploitablePattern === true;
    const utility = (predictable ? 0.55 : 0) + (patternBacked ? 0.35 : 0);
    return { utility, reasoning: { playerPredictable: predictable, hasExploitablePattern: patternBacked } };
  }

  protected computeCost(): number {
    return 0.3;
  }

  protected computeEffects(): Record<string, boolean | number> {
    return { playerPredictabilityExploited: true, playerConfused: true };
  }
}
