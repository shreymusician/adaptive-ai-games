/**
 * Pattern lifecycle — the required state machine:
 *
 *   Unknown -> Candidate -> Confirmed -> Strong -> Weakening -> Retired
 *
 * "Unknown" is not a stored state (see types.ts's PatternLifecycleState doc)
 * — it's the absence of a PatternRecord. Every transition below operates on
 * an EXISTING (or about-to-be-created) record.
 *
 * The promotion gate (whitepaper §5.2: minimum sample count AND
 * statistical concentration) is not a separate check here — it falls out
 * naturally from confidence.ts's formula: `confidence` only clears
 * `confirmedConfidence` once BOTH volume (`asymptoticConfidence`) and
 * concentration are high enough. A freshly-created record legitimately
 * starts life in 'candidate' and stays there until the formula says
 * otherwise — no redundant gate logic needed.
 *
 * Transitions are driven purely by the current confidence value against
 * configured thresholds, with one piece of memory: `everConfirmed`
 * (whether this record has EVER reached 'confirmed' or above) determines
 * whether a mid-range confidence reads as "still building trust"
 * (candidate) or "a real pattern that's fading" (weakening) — these are
 * different claims about the SAME confidence number and deserve different
 * labels, per the explicit lifecycle this phase requires.
 *
 * Recovery is allowed in both directions: a 'weakening' or even 'retired'
 * pattern can climb back to 'confirmed'/'strong' if new evidence supports
 * it again — "never delete historical evidence" means the append-only
 * version log is preserved, not that state is a one-way ratchet.
 */

import { PatternLifecycleState, PatternLifecycleThresholds } from './types';

const EVER_CONFIRMED_STATES: ReadonlySet<PatternLifecycleState> = new Set(['confirmed', 'strong', 'weakening']);

export function nextLifecycleState(previous: PatternLifecycleState | null, confidence: number, thresholds: PatternLifecycleThresholds): PatternLifecycleState {
  const everConfirmed = previous !== null && EVER_CONFIRMED_STATES.has(previous);

  if (confidence >= thresholds.strongConfidence) return 'strong';
  if (confidence >= thresholds.confirmedConfidence) return 'confirmed';
  if (confidence < thresholds.retiredConfidence) return 'retired';
  // Between retired and confirmed thresholds: a real (ever-confirmed) pattern that has faded is "weakening"; a still-unproven one is just "candidate".
  return everConfirmed ? 'weakening' : 'candidate';
}

/** True if `to` represents a promotion relative to `from` (null counts as "below candidate"). Used to classify a transition as a promotion vs. a demotion for PatternRecognitionRunResult reporting. */
export function isPromotion(from: PatternLifecycleState | null, to: PatternLifecycleState): boolean {
  const rank: Record<PatternLifecycleState, number> = { candidate: 0, weakening: 0, confirmed: 1, strong: 2, retired: -1 };
  const fromRank = from === null ? -2 : rank[from];
  return rank[to] > fromRank;
}
