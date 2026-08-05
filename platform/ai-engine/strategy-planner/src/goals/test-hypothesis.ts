import { BaseGoal } from '../goal';
import { GoalEvaluationContext, GoalMetadata } from '../types';

/**
 * Distinct from ScoutUnknownBehavior (which gathers information when
 * little is known at all): TestHypothesis deliberately probes a pattern
 * that IS already confirmed but hasn't yet reached 'strong' — actively
 * seeking the evidence needed to promote or contradict it, the Strategy
 * Planner's analog of Pattern Recognition's own confirmed->strong gate
 * (whitepaper §5.2). Experimental personality weights this goal higher by
 * config (see config.ts's goalOverrides) — a natural fit for its
 * "controlled exploration" bias (§9).
 */
export class TestHypothesisGoal extends BaseGoal {
  readonly metadata: GoalMetadata = {
    id: 'testHypothesis',
    displayName: 'Test Hypothesis',
    category: 'information',
    version: 1,
    interruptPriority: 0,
    description: "Deliberately probe a confirmed-but-not-yet-strong pattern to gather the evidence needed to promote or contradict it.",
  };

  protected checkPreconditions(ctx: GoalEvaluationContext): boolean {
    return ctx.worldState.awarenessTierExpert === true && ctx.worldState.hasExploitablePattern === true;
  }

  protected computeUtility(ctx: GoalEvaluationContext): { utility: number; reasoning: Record<string, unknown> } {
    const count = typeof ctx.worldState.exploitablePatternCount === 'number' ? ctx.worldState.exploitablePatternCount : 0;
    // Moderate, deliberately not dominant utility — this is a hedge, not
    // the AI's primary plan, on any personality except Experimental
    // (which overrides this goal's weight upward in config.ts).
    const utility = Math.min(0.35, 0.15 + count * 0.05);
    return { utility, reasoning: { exploitablePatternCount: count } };
  }

  protected computeCost(): number {
    return 0.25;
  }

  protected computeEffects(): Record<string, boolean | number> {
    return { hypothesisTested: true };
  }
}
