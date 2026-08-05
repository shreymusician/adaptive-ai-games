import { BaseGoal } from '../goal';
import { GoalEvaluationContext, GoalMetadata } from '../types';

/**
 * The information-gathering counterpart to every exploit-oriented goal:
 * when little is confidently known about the player yet, probing for
 * information is itself the highest-value move — directly modeling the
 * whitepaper's "a brand-new player shouldn't feel read on match one" (§7)
 * from the AI's own side: it shouldn't COMMIT to an exploit it doesn't
 * actually have the evidence for yet.
 */
export class ScoutUnknownBehaviorGoal extends BaseGoal {
  readonly metadata: GoalMetadata = {
    id: 'scoutUnknownBehavior',
    displayName: 'Scout Unknown Behavior',
    category: 'information',
    version: 1,
    interruptPriority: 0,
    description: 'Probe rather than commit — the player profile/pattern set is still thin, so gathering information outweighs exploiting an unproven read.',
  };

  protected checkPreconditions(ctx: GoalEvaluationContext): boolean {
    const profileThin = ctx.worldState.semanticProfileAvailable !== true;
    const patternsThin = (typeof ctx.worldState.exploitablePatternCount === 'number' ? ctx.worldState.exploitablePatternCount : 0) < 2;
    return profileThin || patternsThin;
  }

  protected computeUtility(ctx: GoalEvaluationContext): { utility: number; reasoning: Record<string, unknown> } {
    const profileThin = ctx.worldState.semanticProfileAvailable !== true;
    const patternCount = typeof ctx.worldState.exploitablePatternCount === 'number' ? ctx.worldState.exploitablePatternCount : 0;
    // Maximal value at zero knowledge, tapering off as more is confirmed.
    const utility = (profileThin ? 0.5 : 0.2) + Math.max(0, 0.3 - patternCount * 0.15);
    return { utility, reasoning: { profileThin, exploitablePatternCount: patternCount } };
  }

  protected computeCost(): number {
    return 0.15;
  }

  protected computeEffects(): Record<string, boolean | number> {
    return { behaviorScouted: true };
  }
}
