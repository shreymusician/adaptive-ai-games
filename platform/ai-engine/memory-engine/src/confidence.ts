/**
 * Confidence model — ADAPTIVE_AI_ENGINE_WHITEPAPER.md §3.1 and §12.2/§12.5.
 *
 *   value_new  = value_old + α · (observation − value_old)     // EWMA
 *   confidence = 1 − e^(−samples / k)                            // asymptotic, never reaches 1
 *   α          = 1 / (1 + samples), bounded below by α_min       // fast early learning,
 *                                                                 // slows as evidence accumulates
 *
 * This is pure math with no I/O and no interpretation of *what* a dimension
 * means — that judgment (what counts as an "observation" for "aggression")
 * belongs to Player Modeling (future phase). Memory Engine only guarantees
 * the update is applied correctly, consistently, and is fully reproducible
 * from (value, confidence, samples) plus one new observation.
 */

export interface DimensionSnapshot {
  value: number;
  confidence: number;
  samples: number;
}

/** A dimension that has never been observed — the correct zero-state to update from. */
export const UNOBSERVED_DIMENSION: DimensionSnapshot = { value: 0, confidence: 0, samples: 0 };

/**
 * Applies one EWMA observation to a dimension and returns the new state.
 * Never mutates the input. `k` controls how fast confidence climbs toward 1
 * as samples accumulate — tuned per dimension (whitepaper §3.1: "a stable
 * trait ... can use a larger k ... a context-sensitive [one] should use a
 * smaller k").
 */
export function applyObservation(current: DimensionSnapshot, observation: number, k: number, alphaMin: number): DimensionSnapshot {
  if (k <= 0) throw new RangeError('k must be > 0');
  if (alphaMin < 0 || alphaMin > 1) throw new RangeError('alphaMin must be in [0, 1]');

  const samples = current.samples + 1;
  const alpha = Math.max(1 / (1 + current.samples), alphaMin);
  const value = current.value + alpha * (observation - current.value);
  const confidence = asymptoticConfidence(samples, k);

  return { value, confidence, samples };
}

/** `1 - e^(-samples/k)` — shared primitive, also used directly by anything reporting confidence from a raw sample count (e.g. episode confidence inputs upstream). */
export function asymptoticConfidence(samples: number, k: number): number {
  if (k <= 0) throw new RangeError('k must be > 0');
  if (samples <= 0) return 0;
  return 1 - Math.exp(-samples / k);
}

/**
 * Gradual, time-based confidence decay for a dimension that hasn't been
 * observed recently — whitepaper §10's "dormant-dimension confidence decay
 * sweeps" (daily cadence). Exponential decay: confidence never jumps to 0,
 * only fades, and never goes negative. `samples` is intentionally left
 * untouched — decay reflects "this read might be stale," not "we forgot the
 * evidence ever happened."
 */
export function decayConfidence(confidence: number, daysSinceLastUpdate: number, decayRatePerDay: number): number {
  if (decayRatePerDay < 0) throw new RangeError('decayRatePerDay must be >= 0');
  if (daysSinceLastUpdate <= 0 || decayRatePerDay === 0) return confidence;
  return confidence * Math.exp(-decayRatePerDay * daysSinceLastUpdate);
}
