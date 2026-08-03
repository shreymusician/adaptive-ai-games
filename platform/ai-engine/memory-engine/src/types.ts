/**
 * Memory Engine data model — ADAPTIVE_AI_ENGINE_WHITEPAPER.md §4 (four
 * per-player memory components) and §"Schema Note" (playerEpisodes).
 *
 * This module stores information. It does not decide what's significant,
 * what a "good" decision was, or what a player's aggression score should be
 * — those judgments belong to Behavior Analysis / Player Modeling / Pattern
 * Recognition (future phases). Every value that requires interpretation
 * (importance, confidence delta, observation value) arrives here already
 * computed by the caller; Memory Engine's job is to store it correctly,
 * version it, retain the right subset, and make it queryable.
 */

// ---------------------------------------------------------------------------
// 1. Working Memory — current match only, in-process, never persisted.
// ---------------------------------------------------------------------------

/** A single observation pushed into a match's working-memory buffer. Opaque payload — Memory Engine doesn't interpret it. */
export interface WorkingMemoryObservation {
  ts: number;
  kind: string;
  payload: Record<string, unknown>;
}

/**
 * The live, ephemeral state of one in-progress match. Deliberately kept
 * small (whitepaper §4: "a sprawling working-memory representation would
 * make Explainability's job harder, not easier") — `recentObservations` is a
 * bounded ring buffer, not an unbounded log (that's Short-Term Memory's job).
 */
export interface WorkingMemoryState {
  matchId: string;
  playerId: string;
  gameId: string;
  startedAt: number;
  lastTouchedAt: number;
  /** The Strategy Planner's active plan object. Opaque to Memory Engine — stored and returned as-is. */
  plan: Record<string, unknown> | null;
  /** Bounded ring buffer, most-recent last. Capacity set by MemoryEngineConfig.workingMemory.maxObservations. */
  recentObservations: WorkingMemoryObservation[];
  /** Free-form numeric counters a caller wants to accumulate for the duration of the match. */
  counters: Record<string, number>;
  /** Free-form current-context key/values (e.g. "phase": "laning", "targetId": "bot-3"). */
  context: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 2. Short-Term Memory — current match's accumulating record, persisted ONLY
//    at match end (commitMatch). Before that it lives in-process, same as
//    Working Memory, but it survives the match (as a persisted summary)
//    rather than being discarded.
// ---------------------------------------------------------------------------

export interface ShortTermEventRef {
  ts: number;
  eventId?: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface ShortTermBehaviorObservation {
  ts: number;
  dimension: string;
  value: number;
}

export interface ShortTermDecisionRef {
  ts: number;
  decisionId?: string;
  chosenAction: string;
  context?: Record<string, unknown>;
}

/** In-process accumulator for one match, prior to commit. */
export interface ShortTermMemoryState {
  matchId: string;
  playerId: string;
  gameId: string;
  startedAt: number;
  /** Bounded — see MemoryEngineConfig.shortTermMemory.maxEvents. */
  recentEvents: ShortTermEventRef[];
  recentBehaviors: ShortTermBehaviorObservation[];
  recentDecisions: ShortTermDecisionRef[];
  statistics: Record<string, number>;
}

/** The persisted document written by commitMatch() — collection `matchMemories`. */
export interface MatchMemoryRecord {
  matchId: string;
  playerId: string;
  gameId: string;
  startedAt: number;
  committedAt: number;
  durationMs: number;
  summary: string | null;
  recentEvents: ShortTermEventRef[];
  recentBehaviors: ShortTermBehaviorObservation[];
  recentDecisions: ShortTermDecisionRef[];
  statistics: Record<string, number>;
  schemaVersion: 1;
}

// ---------------------------------------------------------------------------
// 3. Long-Term Semantic Memory — versioned player-knowledge dimensions.
//    Collection `playerProfiles` (latest pointer per dimension) +
//    `playerProfileVersions` (append-only history, never overwritten).
// ---------------------------------------------------------------------------

/** `gameId: null` marks a cross-game dimension (whitepaper §11). */
export type GameScope = string | null;

/** The whitepaper's `ProfileDimension {value, confidence, samples, lastUpdated}` (§12.3), plus the versioning this phase adds on top. */
export interface SemanticDimensionState {
  playerId: string;
  gameId: GameScope;
  dimension: string;
  value: number;
  confidence: number;
  samples: number;
  version: number;
  updatedAt: number;
}

/** One immutable entry in a dimension's history. Never deleted, never mutated. */
export interface SemanticDimensionVersion extends SemanticDimensionState {
  previousVersion: number | null;
  /** Optional audit trail: what produced this update. */
  matchId?: string;
  reason?: string;
}

export interface UpdateSemanticMemoryInput {
  playerId: string;
  gameId: GameScope;
  dimension: string;
  observation: number;
  /** Overrides MemoryEngineConfig's default k for this dimension, if provided. */
  k?: number;
  matchId?: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// 4. Long-Term Episodic Memory — bounded, salience-ranked notable encounters.
//    Collection `playerEpisodes`, per whitepaper's Schema Note.
// ---------------------------------------------------------------------------

export type EpisodeType =
  | 'first-victory'
  | 'major-comeback'
  | 'repeated-trap'
  | 'important-mistake'
  | 'repeated-successful-strategy'
  | (string & {}); // extensible — callers may define new episode types without a schema change

export interface PlayerEpisode {
  episodeId: string;
  playerId: string;
  gameId: string;
  matchId: string;
  timestamp: number;
  episodeType: EpisodeType;
  summary: string;
  /** Salience score, [0, 1] — computed by the caller (future Pattern Recognition/Player Modeling). Drives retention ranking. */
  importance: number;
  /** How sure the caller is this episode is correctly characterized, [0, 1]. Independent of importance. */
  confidence: number;
  referencedEvents: string[];
  createdAt: number;
}

export type StoreEpisodeInput = Omit<PlayerEpisode, 'episodeId' | 'createdAt'> & { episodeId?: string };

export interface EpisodeSearchCriteria {
  playerId?: string;
  gameId?: string;
  matchId?: string;
  episodeType?: EpisodeType;
  fromTs?: number;
  toTs?: number;
  minImportance?: number;
  minConfidence?: number;
  /** Sort by recency (default) or by importance descending. */
  sortBy?: 'recent' | 'importance';
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Aggregate read — the "single source of truth" view for future AI modules.
// ---------------------------------------------------------------------------

export interface PlayerMemorySnapshot {
  playerId: string;
  gameId: GameScope;
  semanticProfile: SemanticDimensionState[];
  recentMatches: MatchMemoryRecord[];
  topEpisodes: PlayerEpisode[];
  loadedAt: number;
}
