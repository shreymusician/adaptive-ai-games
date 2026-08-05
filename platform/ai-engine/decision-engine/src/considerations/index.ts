import { DecisionRegistry } from '../registry';
import { DecisionEngineConfig } from '../config';

import { PlanAdherenceConsideration } from './plan-adherence';
import { PunishOpeningConsideration } from './punish-opening';
import { SafetyConsideration } from './safety';
import { PatternExploitConsideration } from './pattern-exploit';
import { ProfileExploitConsideration } from './profile-exploit';
import { ActionFreshnessConsideration } from './action-freshness';

export { PlanAdherenceConsideration, PunishOpeningConsideration, SafetyConsideration, PatternExploitConsideration, ProfileExploitConsideration, ActionFreshnessConsideration };

/**
 * Registers every consideration implemented in this phase. Extending the
 * platform with a new consideration means writing one new file under
 * `src/considerations/` and adding one line here — no existing
 * consideration, the registry, the evaluator, or the selector ever needs to
 * change (same "future evaluators should be pluggable" guarantee every
 * other registry in this monorepo already provides).
 */
export function registerAllConsiderations(registry: DecisionRegistry, config: DecisionEngineConfig): void {
  registry.register(() => new PlanAdherenceConsideration());
  registry.register(() => new PunishOpeningConsideration());
  registry.register(() => new SafetyConsideration());
  registry.register(() => new PatternExploitConsideration());
  registry.register(() => new ProfileExploitConsideration({ thresholds: config.worldFactThresholds }));
  registry.register(() => new ActionFreshnessConsideration({ thresholds: config.worldFactThresholds }));
}
