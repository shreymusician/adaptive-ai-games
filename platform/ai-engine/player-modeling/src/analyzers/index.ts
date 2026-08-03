import { DimensionRegistry } from '../registry';
import { ReactionTimeAnalyzer } from './reaction-time';
import { DecisionSpeedAnalyzer } from './decision-speed';
import { AggressionAnalyzer } from './aggression';
import { RiskToleranceAnalyzer } from './risk-tolerance';
import { ConsistencyAnalyzer } from './consistency';
import { PredictabilityAnalyzer } from './predictability';
import { LearningRateAnalyzer } from './learning-rate';
import { MechanicalSkillAnalyzer } from './mechanical-skill';
import { StrategicSkillAnalyzer } from './strategic-skill';
import { ExplorationAnalyzer } from './exploration';
import { PreferredCombatDistanceAnalyzer } from './preferred-combat-distance';
import { PreferredStrategiesAnalyzer } from './preferred-strategies';
import { PlayerConfidenceAnalyzer } from './player-confidence';

export {
  ReactionTimeAnalyzer,
  DecisionSpeedAnalyzer,
  AggressionAnalyzer,
  RiskToleranceAnalyzer,
  ConsistencyAnalyzer,
  PredictabilityAnalyzer,
  LearningRateAnalyzer,
  MechanicalSkillAnalyzer,
  StrategicSkillAnalyzer,
  ExplorationAnalyzer,
  PreferredCombatDistanceAnalyzer,
  PreferredStrategiesAnalyzer,
  PlayerConfidenceAnalyzer,
};

/**
 * Registers every dimension analyzer implemented in Phase 5. Extending the
 * platform with a new dimension (whitepaper's extensibility requirement —
 * Curiosity, Adaptability, Creativity, ...) means writing one new analyzer
 * file and adding one line here — no existing analyzer or registry code
 * changes.
 */
export function registerAllAnalyzers(registry: DimensionRegistry): void {
  registry.register(() => new ReactionTimeAnalyzer());
  registry.register(() => new DecisionSpeedAnalyzer());
  registry.register(() => new AggressionAnalyzer());
  registry.register(() => new RiskToleranceAnalyzer());
  registry.register(() => new ConsistencyAnalyzer());
  registry.register(() => new PredictabilityAnalyzer());
  registry.register(() => new MechanicalSkillAnalyzer());
  registry.register(() => new StrategicSkillAnalyzer());
  registry.register(() => new ExplorationAnalyzer());
  registry.register(() => new PreferredCombatDistanceAnalyzer());
  registry.register(() => new PreferredStrategiesAnalyzer());
  // Registered after their dependencies exist so executionOrder()'s
  // validation reads naturally top-to-bottom; actual ordering is resolved
  // by the registry regardless of registration order.
  registry.register(() => new LearningRateAnalyzer());
  registry.register(() => new PlayerConfidenceAnalyzer());
}
