import { GoalRegistry } from '../registry';

import { PressurePlayerGoal } from './pressure-player';
import { ForceMovementGoal } from './force-movement';
import { ForceReloadGoal } from './force-reload';
import { ControlSpaceGoal } from './control-space';
import { DenyResourcesGoal } from './deny-resources';
import { CreateAmbushGoal } from './create-ambush';
import { BreakPredictablePatternGoal } from './break-predictable-pattern';
import { ScoutUnknownBehaviorGoal } from './scout-unknown-behavior';
import { ProtectObjectiveGoal } from './protect-objective';
import { RetreatGoal } from './retreat';
import { RegroupGoal } from './regroup';
import { DelayEngagementGoal } from './delay-engagement';
import { SplitTargetsGoal } from './split-targets';
import { TestHypothesisGoal } from './test-hypothesis';

export {
  PressurePlayerGoal,
  ForceMovementGoal,
  ForceReloadGoal,
  ControlSpaceGoal,
  DenyResourcesGoal,
  CreateAmbushGoal,
  BreakPredictablePatternGoal,
  ScoutUnknownBehaviorGoal,
  ProtectObjectiveGoal,
  RetreatGoal,
  RegroupGoal,
  DelayEngagementGoal,
  SplitTargetsGoal,
  TestHypothesisGoal,
};

/**
 * Registers every goal implemented in this phase. Extending the platform
 * with a new goal means writing one new file under `src/goals/` and adding
 * one line here — no existing goal, the registry, the GOAP planner, or the
 * StrategyPlanner engine ever need to change (whitepaper's "future goals
 * should require no changes to existing planner code").
 *
 * IMPORTANT: RegroupGoal must remain registered — it is the guaranteed-
 * eligible fallback the planner relies on to never throw NoEligibleGoalError.
 */
export function registerAllGoals(registry: GoalRegistry): void {
  registry.register(() => new RegroupGoal()); // fallback — registered first for readability, order is irrelevant (registry sorts by dependsOn)
  registry.register(() => new RetreatGoal());
  registry.register(() => new ProtectObjectiveGoal());
  registry.register(() => new DelayEngagementGoal());
  registry.register(() => new PressurePlayerGoal());
  registry.register(() => new ForceMovementGoal());
  registry.register(() => new ForceReloadGoal());
  registry.register(() => new ControlSpaceGoal());
  registry.register(() => new DenyResourcesGoal());
  registry.register(() => new CreateAmbushGoal());
  registry.register(() => new BreakPredictablePatternGoal());
  registry.register(() => new ScoutUnknownBehaviorGoal());
  registry.register(() => new TestHypothesisGoal());
  registry.register(() => new SplitTargetsGoal());
}
