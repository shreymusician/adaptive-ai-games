/**
 * DecisionEvaluator — runs every registered Consideration against ONE
 * legal action and combines their results into that action's utility via a
 * weighted linear combination (whitepaper §12.2's "weighted linear-
 * combination utility scoring"):
 *
 *   utility = sum(personalityWeight_i * value_i) / sum(personalityWeight_i)
 *
 * Personality is applied here, exactly once, as the weight — never inside
 * a Consideration itself (see personality.ts's doc comment).
 */

import { DecisionRegistry } from './registry';
import { DecisionEngineConfig } from './config';
import { resolvePersonalityWeight } from './personality';
import { Logger } from './logger';
import { Action, ActionScore, AwarenessUsedAccumulator, DecisionWorldFacts, MaskedDecisionInputs, PersonalityArchetype } from './types';

export function evaluateAction(
  registry: DecisionRegistry,
  action: Action,
  now: number,
  inputs: MaskedDecisionInputs,
  worldFacts: DecisionWorldFacts,
  awarenessUsed: AwarenessUsedAccumulator,
  personality: PersonalityArchetype,
  config: DecisionEngineConfig,
  logger?: Logger
): ActionScore {
  const { results } = registry.evaluateAll({ action, now, inputs, worldFacts, awarenessUsed }, logger);

  const breakdown = [...results.values()];
  let weightedSum = 0;
  let weightTotal = 0;
  for (const result of breakdown) {
    const meta = registry.get(result.considerationId)!;
    const weight = resolvePersonalityWeight(config.personality, personality, meta);
    weightedSum += weight * result.value;
    weightTotal += weight;
  }

  const utility = weightTotal > 0 ? weightedSum / weightTotal : 0.5;
  return { action, utility, breakdown };
}
