/**
 * Personality at the Decision Engine layer — ADAPTIVE_AI_ENGINE_WHITEPAPER.md
 * §9: "a named preset of Utility AI consideration weights ... applied
 * uniformly on top of whatever the Player Profile and Strategy Planner have
 * genuinely learned. Same facts, different scoring, different resulting
 * action."
 *
 * This file is the ONLY place personality touches the Decision Engine: it
 * resolves a multiplicative weight per consideration category, nothing
 * else. No Consideration ever sees which personality is active —
 * ConsiderationContext deliberately excludes it, exactly mirroring
 * @adaptive-ai/strategy-planner's GoalEvaluationContext.
 */

import { ConsiderationMetadata, PersonalityArchetype } from './types';
import { PersonalityConfig, PersonalityProfile } from './config';

export function resolvePersonalityWeight(config: PersonalityConfig, personality: PersonalityArchetype, meta: ConsiderationMetadata): number {
  const profile: PersonalityProfile = config[personality];
  const categoryWeight = profile.categoryWeights[meta.category] ?? 1;
  const override = profile.considerationOverrides[meta.id] ?? 1;
  return categoryWeight * override;
}

/** [0,1] — 0 for every personality except Experimental. */
export function explorationEpsilon(config: PersonalityConfig, personality: PersonalityArchetype): number {
  return config[personality].explorationEpsilon;
}

/**
 * Deterministic pseudo-random source for Experimental's exploration term —
 * seeded from caller-supplied values, never Math.random() or wall-clock
 * entropy, so a replayed decide() call with the same inputs (and the same
 * seed) produces the same exploration decision. Identical implementation to
 * strategy-planner's seededUnitRandom — see that file's doc comment for the
 * determinism rationale; duplicated here for the same "small dependency-free
 * primitive" reason as computeAwarenessTier (see awareness-budget.ts).
 */
export function seededUnitRandom(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0xffffffff;
}
