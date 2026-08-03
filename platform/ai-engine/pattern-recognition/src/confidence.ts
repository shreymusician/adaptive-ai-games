/**
 * Pattern confidence model — ADAPTIVE_AI_ENGINE_WHITEPAPER.md §5.2.
 *
 * Deliberately a DIFFERENT trust model than Player Modeling's plain EWMA
 * (§3.1): a pattern isn't just "a number," it's a CLAIM ("this player
 * reloads after two shots") that can be flatly wrong if promoted
 * prematurely. Two things must hold before a claim is trusted:
 *
 *   1. VOLUME  — enough observations at all (`asymptoticConfidence`,
 *      reused verbatim from @adaptive-ai/memory-engine — not reimplemented).
 *   2. CONCENTRATION — the observed share is meaningfully peaked relative
 *      to a uniform-random null hypothesis, not just "we saw it a lot."
 *
 * Confidence is the product of both. On top of that, whitepaper §5.2
 * requires ASYMMETRIC decay: a contradicting observation this match must
 * drop confidence faster than confirming observations grow it — a player
 * who visibly patched a habit should stop being "read" quickly, not
 * sluggishly re-weighted. This decays confidence gets a nonzero PENALTY
 * multiplier only on a match that saw both a match on this observation
 * and its opposite (i.e. `matches < opportunities`, at least one
 * contradiction), applied ON TOP of the volume*concentration formula
 * (never below what it would otherwise be — the penalty is a cap, applied
 * as `min(formula, prior * (1 - contradictionDecayRate))`).
 *
 * Separately, `decayDormantConfidence` reuses @adaptive-ai/memory-engine's
 * `decayConfidence` verbatim for TIME-based dormancy (whitepaper §10's
 * daily-cadence sweep) — a pattern that simply hasn't been observed in a
 * while, independent of any contradiction.
 */

import { asymptoticConfidence, decayConfidence } from '@adaptive-ai/memory-engine';
import { PatternConfidenceState, PatternTuning } from './types';
import { clamp } from './stats';

export const UNOBSERVED_PATTERN: PatternConfidenceState = { observationCount: 0, supportingEvidence: 0, confidence: 0 };

/**
 * Folds one match's BATCH of (opportunities, matches) into a pattern's
 * running state. Never mutates `prior`. `matches` may be 0 (a match that
 * saw the qualifying context but never the specific claim — a pure
 * contradiction) up to `opportunities` (every qualifying instance matched).
 */
export function applyPatternObservation(prior: PatternConfidenceState, opportunities: number, matches: number, tuning: PatternTuning): PatternConfidenceState {
  if (opportunities <= 0) throw new RangeError('opportunities must be > 0');
  if (matches < 0 || matches > opportunities) throw new RangeError('matches must be in [0, opportunities]');

  const observationCount = prior.observationCount + opportunities;
  const supportingEvidence = prior.supportingEvidence + matches;
  const concentration = supportingEvidence / observationCount;

  const volumeConfidence = asymptoticConfidence(observationCount, tuning.k);
  const concentrationScore = clamp((concentration - tuning.concentrationBaseline) / (1 - tuning.concentrationBaseline), 0, 1);
  const formulaConfidence = volumeConfidence * concentrationScore;

  // The extra penalty only makes sense against an ALREADY-established read (prior.observationCount > 0) —
  // a brand-new pattern's very first batch has no existing trust to decay away, so it stands purely on
  // this batch's own volume+concentration merit even if that first batch contains a contradiction.
  const contradicted = matches < opportunities && prior.observationCount > 0;
  const confidence = contradicted ? Math.min(formulaConfidence, prior.confidence * (1 - tuning.contradictionDecayRate)) : formulaConfidence;

  return { observationCount, supportingEvidence, confidence };
}

/** Time-based dormancy decay — whitepaper §10, reusing Memory Engine's primitive directly. Does not touch observationCount/supportingEvidence: decay reflects "this read might be stale," not "we forgot the evidence ever happened." */
export function decayDormantConfidence(confidence: number, daysSinceLastObserved: number, decayRatePerDay: number): number {
  return decayConfidence(confidence, daysSinceLastObserved, decayRatePerDay);
}
