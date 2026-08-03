/**
 * Player Modeling domain types — ADAPTIVE_AI_ENGINE_WHITEPAPER.md §3
 * (Player Modeling Framework).
 *
 * Player Modeling answers exactly one question: "what kind of player is
 * this?" It consumes canonical Event Pipeline data (via the Memory Engine's
 * per-match `MatchMemoryRecord`), Working Memory, and prior Semantic/
 * Episodic Memory; it produces updated semantic dimensions, confidence
 * values, modeling metadata, and episode candidates. It never decides what
 * the AI should do with any of that — that boundary belongs to
 * strategy-planner / decision-engine.
 */

import { MatchMemoryRecord, SemanticDimensionState, SemanticDimensionVersion, ShortTermEventRef } from '@adaptive-ai/memory-engine';
import { PlayerModelingConfig } from './config';

export type { MatchMemoryRecord, SemanticDimensionState, SemanticDimensionVersion, ShortTermEventRef };

/** The whitepaper's `ProfileDimension {value, confidence, samples, lastUpdated}`, pre-persistence — what an analyzer's `update()` computes. */
export interface DimensionSnapshotInput {
  value: number;
  confidence: number;
  samples: number;
}

/**
 * One scalar observation an analyzer wants folded into a persisted semantic
 * dimension this match. `key` is the full dimension id passed to
 * MemoryEngine.updateSemanticMemory — for continuous dimensions this equals
 * the analyzer's own metadata.id; for categorical dimensions (§3.3) it is
 * `${metadata.id}:${category}`, one entry per category observed this match.
 */
export interface DimensionObservationEntry {
  key: string;
  /** The raw observation value fed into the shared EWMA primitive this match. Unit is dimension-specific (ms, ratio in [0,1], per-category share in [0,1], …). */
  observation: number;
  /** How many raw events/decisions this observation was derived from — for transparency/debugging, not itself part of the EWMA math. */
  sampleCount: number;
}

/**
 * The result of running one analyzer over one match. An empty `entries`
 * array (or a `matchConfidence` below the dimension's configured gate) means
 * "no claim made this match" — Player Modeling never fabricates an
 * observation from insufficient evidence.
 */
export interface DimensionAnalyzerResult {
  entries: DimensionObservationEntry[];
  /**
   * [0,1] — how much this match's evidence should be trusted, e.g. based on
   * how many qualifying events were seen. This is a per-match evidence gate,
   * DISTINCT from the persisted cross-match confidence Memory Engine tracks
   * via (samples, k) — see README "Two confidences" for the full
   * distinction.
   */
  matchConfidence: number;
  /** Free-form debug/explainability metadata — e.g. which raw counts fed the observation. Never used for decision-making, only transparency. */
  metadata?: Record<string, unknown>;
}

export type DimensionKind = 'continuous' | 'categorical';
export type DimensionScope = 'per-game' | 'cross-game';

export interface DimensionAnalyzerMetadata {
  /** Stable identifier — also the Memory Engine `dimension` key for continuous dimensions, and the category-key prefix for categorical ones. Never renamed once shipped (see README "Versioning"). */
  id: string;
  displayName: string;
  /** Bumped whenever this analyzer's observation-derivation logic changes in a way that makes historical values non-comparable to new ones. Recorded in Memory Engine's `reason` field on every write. */
  version: number;
  kind: DimensionKind;
  scope: DimensionScope;
  /**
   * Other dimension ids whose THIS-MATCH result (from the same registry run)
   * this analyzer reads via `AnalyzerRunContext.siblingResults`. The registry
   * topologically orders execution so dependencies always run first.
   */
  dependsOn?: string[];
  /**
   * Dimension ids whose PERSISTED history (not this match's result) this
   * analyzer needs — e.g. Learning Rate reading recent versions of
   * mechanicalSkill. The engine prefetches a bounded window (see
   * PlayerModelingConfig.historyLookbackVersions) and injects it into
   * `AnalyzerRunContext.historicalSeries`.
   */
  historyDependsOn?: string[];
  description: string;
}

export interface AnalyzerRunContext {
  playerId: string;
  gameId: string;
  matchId: string;
  now: number;
  match: MatchMemoryRecord;
  /** The player's full semantic profile as of BEFORE this match, keyed by `${gameId ?? 'cross'}::${dimension}`. */
  priorProfile: ReadonlyMap<string, SemanticDimensionState>;
  /** Results already produced earlier in this run by dimensions this analyzer declared in `dependsOn`. Populated in dependency order. */
  siblingResults: ReadonlyMap<string, DimensionAnalyzerResult>;
  /** Bounded recent version history for dimensions declared in `historyDependsOn`, most-recent first. */
  historicalSeries: ReadonlyMap<string, SemanticDimensionVersion[]>;
  /** Tunable thresholds/buckets analyzers need beyond EWMA `k` (e.g. combat-distance buckets, risk threshold) — never hardcoded in analyzer files. */
  settings: PlayerModelingConfig;
}

export function priorProfileKey(gameId: string | null, dimension: string): string {
  return `${gameId ?? 'cross'}::${dimension}`;
}

/** One update Player Modeling actually committed through Memory Engine this run. */
export interface CommittedDimensionUpdate {
  key: string;
  gameId: string | null;
  value: number;
  confidence: number;
  samples: number;
  version: number;
  priorValue: number | null;
}

export interface SkippedDimension {
  dimensionId: string;
  reason: string;
}

export interface AnalyzerFailure {
  dimensionId: string;
  error: string;
}

/** A candidate episode Player Modeling proposes to Memory Engine — always below Pattern Recognition's future, richer salience scoring; see README "Known limitations". */
export interface EpisodeCandidate {
  episodeType: string;
  summary: string;
  importance: number;
  confidence: number;
  dimension: string;
  stored: boolean;
}

export interface PlayerModelingRunResult {
  playerId: string;
  gameId: string;
  matchId: string;
  updated: CommittedDimensionUpdate[];
  skipped: SkippedDimension[];
  errors: AnalyzerFailure[];
  episodeCandidates: EpisodeCandidate[];
  ranAt: number;
}
