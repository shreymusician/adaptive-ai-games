/**
 * Personality — ADAPTIVE_AI_ENGINE_WHITEPAPER.md §9.
 *
 * "A named preset of ... consideration weights ... applied uniformly on top
 * of whatever the Player Profile and Strategy Planner have genuinely
 * learned. Same facts, different scoring, different resulting action."
 *
 * This file is intentionally the ONLY place personality touches the
 * planner: it resolves a multiplicative weight per goal, nothing else.
 * Personality never mutates a Goal's utility/cost computation, never
 * touches PlanningInputs, never writes to memory or a player model — it
 * only scales an already-computed utility number before the GOAP search
 * scores candidates.
 */

import { GoalMetadata, PersonalityArchetype } from './types';
import { PersonalityConfig, PersonalityProfile } from './config';

/** goalId -> resolved weight = categoryWeight * (goalOverride ?? 1). Deterministic, pure. */
export function resolvePersonalityWeight(config: PersonalityConfig, personality: PersonalityArchetype, meta: GoalMetadata): number {
  const profile: PersonalityProfile = config[personality];
  const categoryWeight = profile.categoryWeights[meta.category] ?? 1;
  const override = profile.goalOverrides[meta.id] ?? 1;
  return categoryWeight * override;
}

/** [0,1] — 0 for every personality except Experimental (whitepaper §9's "controlled exploration term"). */
export function explorationEpsilon(config: PersonalityConfig, personality: PersonalityArchetype): number {
  return config[personality].explorationEpsilon;
}

/**
 * Deterministic pseudo-random source for Experimental's exploration term —
 * seeded from the match/tick-scoped values a caller provides (never
 * `Math.random()`), so a replayed planning call with the same inputs
 * produces the same exploration decision (whitepaper §12.14: "what stays
 * deterministic" applies to every part of this pipeline, including the
 * exploration term itself — the RANDOMNESS is a function of a supplied
 * seed, not of wall-clock entropy).
 */
export function seededUnitRandom(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Map the 32-bit hash to [0, 1).
  return (hash >>> 0) / 0xffffffff;
}
