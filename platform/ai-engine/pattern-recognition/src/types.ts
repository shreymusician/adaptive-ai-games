/**
 * Pattern Recognition domain types — ADAPTIVE_AI_ENGINE_WHITEPAPER.md §5
 * (Pattern Recognition).
 *
 * Where Player Modeling (Phase 5) tracks CONTINUOUS traits ("aggression:
 * 0.84"), Pattern Recognition finds DISCRETE, nameable habits backed by
 * statistical evidence ("reloads after exactly two shots"). It answers only
 * "what habits does this player repeatedly demonstrate?" — never planning,
 * never decision-making, never updating continuous traits (that remains
 * player-modeling's job, which this package treats as stable/frozen and
 * only ever READS from, via its run result).
 */

import { MatchMemoryRecord, PlayerEpisode, ShortTermEventRef } from '@adaptive-ai/memory-engine';
import { PlayerModelingRunResult } from '@adaptive-ai/player-modeling';
import { PatternRecognitionConfig } from './config';

export type { MatchMemoryRecord, PlayerEpisode, ShortTermEventRef, PlayerModelingRunResult };

export type PatternCategory = 'movement' | 'combat' | 'decision' | 'exploration' | 'risk';

/**
 * Unknown is deliberately NOT a stored state — it is the absence of a
 * PatternRecord entirely (whitepaper: a claim isn't made at all below the
 * promotion gate). Every other state corresponds to a persisted record;
 * "never delete historical evidence" means the record's STATE changes but
 * the record (and its append-only version history) is never removed, even
 * once 'retired'.
 */
export type PatternLifecycleState = 'candidate' | 'confirmed' | 'strong' | 'weakening' | 'retired';

export interface PatternLifecycleThresholds {
  /** Confidence at/above which a pattern is 'confirmed' (also the floor a 'weakening' pattern must clear to become 'confirmed' again). */
  confirmedConfidence: number;
  /** Confidence at/above which a 'confirmed' pattern becomes 'strong'. */
  strongConfidence: number;
  /** Confidence below which a pattern is 'retired' — never surfaced to consumers, but never deleted. */
  retiredConfidence: number;
}

/** Per-detector tuning — never hardcoded inside a detector file. */
export interface PatternTuning {
  /** EWMA-style time-constant for the VOLUME half of pattern confidence (`asymptoticConfidence(observationCount, k)`) — see confidence.ts. */
  k: number;
  /** The uniform-random null-hypothesis baseline this pattern's concentration is compared against (whitepaper §5.2) — e.g. 0.5 for a two-way choice, 1/3 for a three-way one. */
  concentrationBaseline: number;
  /** Extra multiplicative confidence penalty applied ONLY when a match contains at least one contradicting observation — whitepaper §5.2's "decays faster than it grows." */
  contradictionDecayRate: number;
  /** Daily dormancy decay rate (whitepaper §10) — reuses @adaptive-ai/memory-engine's `decayConfidence` verbatim. 0 disables dormancy decay. */
  decayRatePerDay: number;
  lifecycle: PatternLifecycleThresholds;
}

/** The running (observationCount, supportingEvidence, confidence) triple a pattern's confidence math operates on — the pattern-recognition analog of Memory Engine's DimensionSnapshot. */
export interface PatternConfidenceState {
  observationCount: number;
  supportingEvidence: number;
  confidence: number;
}

/** One persisted, versioned pattern record — collection `playerPatterns` (latest) / `playerPatternVersions` (history), owned by this package's own PatternStore (Memory Engine has no pattern-specific collection; see README "Persistence boundary"). */
export interface PatternRecord {
  playerId: string;
  gameId: string;
  detectorId: string;
  /** Discriminates multiple concurrent claims from one detector (e.g. specific dodge direction 'left'). */
  patternKey: string;
  /** `${detectorId}:${patternKey}` — the stable, human-legible slug (matches PLATFORM_V2_DESIGN.md §6's `playerPatterns.patternId` convention). */
  patternId: string;
  category: PatternCategory;
  description: string;
  state: PatternLifecycleState;
  observationCount: number;
  supportingEvidence: number;
  confidence: number;
  decayRatePerDay: number;
  promotionThreshold: number;
  retirementThreshold: number;
  firstDetectedAt: number;
  lastObservedAt: number;
  lastSeenMatchId: string;
  version: number;
  metadata: Record<string, unknown>;
}

/** One immutable entry in a pattern's history. Never deleted, never mutated — "never delete historical evidence." */
export interface PatternVersion extends PatternRecord {
  previousVersion: number | null;
  /** The lifecycle transition this version represents, if the state changed from the previous version. */
  transition: { from: PatternLifecycleState | null; to: PatternLifecycleState } | null;
}

export interface PatternSearchCriteria {
  playerId?: string;
  gameId?: string;
  detectorId?: string;
  category?: PatternCategory;
  state?: PatternLifecycleState;
  minConfidence?: number;
  /** Only patterns last observed at/after this timestamp — "recent activity". */
  observedSince?: number;
  fromTs?: number;
  toTs?: number;
  sortBy?: 'confidence' | 'recent';
  limit?: number;
  offset?: number;
}

/** One (patternKey, evidence) pair a detector reports for the current match. `opportunities`/`matches` are BATCH counts for this match, not per-event — folded into the persisted running totals by the engine. */
export interface PatternKeyDelta {
  patternKey: string;
  description: string;
  /** How many qualifying instances of this claim's decision context occurred this match. */
  opportunities: number;
  /** Of those, how many were consistent with the claim. `matches < opportunities` is a contradicting match (triggers the asymmetric decay penalty). */
  matches: number;
  metadata?: Record<string, unknown>;
}

export interface DetectorResult {
  deltas: PatternKeyDelta[];
}

export interface PatternDetectorMetadata {
  id: string;
  displayName: string;
  category: PatternCategory;
  /** Bumped whenever this detector's claim-derivation logic changes in a way that makes historical values non-comparable — recorded in every PatternVersion's metadata. */
  version: number;
  /** Other detector ids whose THIS-MATCH result this detector reads via `DetectorRunContext.siblingResults`. Registry topologically orders execution accordingly. */
  dependsOn?: string[];
  description: string;
}

export interface DetectorRunContext {
  playerId: string;
  gameId: string;
  matchId: string;
  now: number;
  match: MatchMemoryRecord;
  /** Player Modeling's output for this same match — an allowed input (whitepaper Phase 6: "Player Modeling output"). May be null if the caller chooses not to run Player Modeling first for a given match. */
  playerModelingResult: PlayerModelingRunResult | null;
  /** Recent Episodic Memory for this player+game — an allowed input, fetched once per run for any detector that wants it. */
  recentEpisodes: readonly PlayerEpisode[];
  /** This player's current persisted pattern records, keyed by `patternId`, as of BEFORE this match. */
  priorPatterns: ReadonlyMap<string, PatternRecord>;
  /** Results already produced earlier in this run by detectors this detector declared in `dependsOn`. */
  siblingResults: ReadonlyMap<string, DetectorResult>;
  settings: PatternRecognitionConfig;
}

export function patternId(detectorId: string, patternKey: string): string {
  return `${detectorId}:${patternKey}`;
}

export interface PatternTransitionEvent {
  patternId: string;
  playerId: string;
  gameId: string;
  from: PatternLifecycleState | null;
  to: PatternLifecycleState;
  confidence: number;
}

export interface SkippedDetector {
  detectorId: string;
  reason: string;
}

export interface DetectorFailure {
  detectorId: string;
  error: string;
}

export interface PatternRecognitionRunResult {
  playerId: string;
  gameId: string;
  matchId: string;
  updated: PatternRecord[];
  promotions: PatternTransitionEvent[];
  demotions: PatternTransitionEvent[];
  skipped: SkippedDetector[];
  errors: DetectorFailure[];
  ranAt: number;
}
