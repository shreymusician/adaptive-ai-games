/**
 * Builds the small, tick-cadence DecisionWorldFacts bag every Consideration
 * reads — the Decision Engine's own narrow analog of Strategy Planner's
 * (much larger, match-cadence) AbstractWorldState. Derived ONLY from
 * PublicGameState/StrategicIntent, purely, deterministically — no I/O, no
 * randomness, never reused across decide() calls.
 */

import { WorldFactThresholds } from './config';
import { DecisionWorldFacts, MaskedDecisionInputs } from './types';

export function buildWorldFacts(masked: MaskedDecisionInputs, thresholds: WorldFactThresholds): DecisionWorldFacts {
  const facts: Record<string, boolean | number> = {};
  const gs = masked.publicGameState;

  if (gs.selfHealth !== undefined) {
    facts.selfHealth = gs.selfHealth;
    facts.selfHealthLow = gs.selfHealth < thresholds.healthLow;
  }
  if (gs.playerHealthVisible !== undefined) {
    facts.playerHealthVisible = gs.playerHealthVisible;
    facts.playerHealthLow = gs.playerHealthVisible < thresholds.healthLow;
  }
  if (gs.selfResourcesLow !== undefined) {
    facts.selfResourcesLowValue = gs.selfResourcesLow;
    facts.selfResourcesLow = gs.selfResourcesLow >= thresholds.resourcesLow;
  }
  if (gs.spaceContested !== undefined) facts.spaceContestedValue = gs.spaceContested;
  facts.objectiveThreatened = gs.objectiveThreatened === true;
  facts.playerRetreating = gs.playerRetreating === true;
  facts.openingAvailable = gs.openingAvailable === true;
  for (const [key, value] of Object.entries(gs.extra ?? {})) {
    facts[`extra_${key}`] = value;
  }

  // The intent's goalId/category are strings, not DecisionFactValue (boolean
  // | number) — considerations that need them read
  // ctx.inputs.strategicIntent directly (always available, never gated by
  // awareness) rather than through this numeric/boolean-only fact bag.
  facts.strategicConfidence = masked.strategicIntent.confidence;

  return Object.freeze(facts);
}
