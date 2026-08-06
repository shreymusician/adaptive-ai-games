/**
 * Explainability Engine domain types — ADAPTIVE_AI_ENGINE_WHITEPAPER.md §8.
 *
 * "Design principle, stated as a hard constraint, not a preference:
 * explanations must be a deterministic *readout* of the actual decision
 * trace, never a separate post-hoc generative step." Every type below is a
 * STRUCTURED, machine-readable representation built ONLY from fields that
 * already exist on `Decision` / `StrategicIntent` / caller-supplied memory
 * context. Natural language (`naturalLanguage: string[]`) is rendered from
 * this structure by templates.ts — never the other way around.
 *
 * Like @adaptive-ai/decision-engine and @adaptive-ai/strategy-planner, this
 * package imports its input types directly from the upstream packages that
 * define them (Decision from decision-engine, StrategicIntent from
 * strategy-planner, PlayerEpisode/SemanticDimensionVersion from
 * memory-engine) rather than re-declaring them — they are the SAME
 * documents this module reads out, not a separate contract.
 */

import { Action, AlternativeCandidate, AwarenessTier, ConsiderationResult, Decision, DecisionWorldFacts, PersonalityArchetype } from '@adaptive-ai/decision-engine';
import { AwarenessUsed as StrategyAwarenessUsed, GoalCandidateTrace, GoalCategory, PatternEntry, SemanticProfileEntry, StrategicIntent } from '@adaptive-ai/strategy-planner';
import { PlayerEpisode, SemanticDimensionVersion } from '@adaptive-ai/memory-engine';

export type {
  Action,
  AlternativeCandidate,
  AwarenessTier,
  ConsiderationResult,
  Decision,
  DecisionWorldFacts,
  PersonalityArchetype,
  GoalCandidateTrace,
  GoalCategory,
  PatternEntry,
  SemanticProfileEntry,
  StrategicIntent,
  PlayerEpisode,
  SemanticDimensionVersion,
};

// ---------------------------------------------------------------------------
// Inputs — the closed set of things the Explainability Engine may read, per
// this phase's mandate. `semanticProfile`/`patterns`/`episodes` are the
// CALLER'S full known context (e.g. everything Memory Engine currently has
// on file) — the engine itself is responsible for filtering this down to
// only what a specific Decision/StrategicIntent's own AwarenessUsed record
// says was actually read (see decision-explainer.ts), never trusting the
// caller to have pre-filtered it. This mirrors Decision Engine's own
// "receives the full context, masks it itself" convention.
// ---------------------------------------------------------------------------

export interface ExplanationInputs {
  decision: Decision;
  strategicIntent: StrategicIntent;
  semanticProfile: SemanticProfileEntry[];
  patterns: PatternEntry[];
  episodes: PlayerEpisode[];
}

// ---------------------------------------------------------------------------
// Confidence — whitepaper §8: "never fabricate certainty." Always derived
// from a real numeric confidence already present on the source record.
// ---------------------------------------------------------------------------

export type ConfidenceLevel = 'low' | 'medium' | 'high';

export interface ConfidenceReading {
  value: number;
  level: ConfidenceLevel;
}

// ---------------------------------------------------------------------------
// Evidence / traceability — "every sentence must map back to specific
// reasoning data ... recoverable programmatically."
// ---------------------------------------------------------------------------

export type EvidenceKind = 'consideration' | 'pattern' | 'semanticDimension' | 'episode' | 'goal' | 'alternativeAction' | 'worldFact' | 'planStep';

export interface EvidenceRef {
  kind: EvidenceKind;
  id: string;
  label: string;
  detail: Record<string, unknown>;
}

/** One traceable claim (a field path into the structured explanation, e.g. "primaryReason", "supportingEvidence[0]") plus the evidence it was built from. Every `naturalLanguage` sentence has exactly one corresponding entry, at the same array index, in the owning explanation's `traceability`. */
export interface TraceabilityEntry {
  claim: string;
  evidence: EvidenceRef[];
}

export type TraceabilityMap = TraceabilityEntry[];

// ---------------------------------------------------------------------------
// Decision Explanation — the core, per-tick explanation type.
// ---------------------------------------------------------------------------

export interface DecisionSummary {
  actionId: string;
  goalId: string;
  goalDisplayName: string;
  goalCategory: GoalCategory;
  personality: PersonalityArchetype;
  utility: number;
}

export interface PrimaryReason {
  considerationId: string;
  considerationWeight: number;
  considerationValue: number;
  /** weight × value — this consideration's share of the winning action's weighted-sum utility. Always the single highest-contribution consideration; ties broken by ascending considerationId. */
  contribution: number;
  reasoning: Record<string, unknown>;
}

export interface SupportingEvidenceItem {
  considerationId: string;
  considerationWeight: number;
  considerationValue: number;
  contribution: number;
  reasoning: Record<string, unknown>;
}

export interface AlternativeConsidered {
  actionId: string;
  utility: number;
  rank: number;
  utilityGapFromWinner: number;
}

export interface PatternUsed {
  patternId: string;
  category: string;
  description: string;
  confidence: ConfidenceReading;
  state: PatternEntry['state'];
}

export interface PlayerTraitUsed {
  dimension: string;
  value: number;
  confidence: ConfidenceReading;
  samples: number;
}

export interface MemoryReferenced {
  episodeId: string;
  episodeType: string;
  summary: string;
  importance: number;
  confidence: ConfidenceReading;
  timestamp: number;
}

export interface DecisionExplanation {
  explanationId: string;
  decisionId: string;
  matchId: string;
  playerId: string;
  gameId: string;
  /** Always `decision.executionTimestamp` — never wall-clock at generation time, so the same Decision always produces the same explanation regardless of when it's rendered. */
  generatedAt: number;
  summary: DecisionSummary;
  primaryReason: PrimaryReason;
  supportingEvidence: SupportingEvidenceItem[];
  alternativesConsidered: AlternativeConsidered[];
  /** Sourced ONLY from decision.reasoningTrace.awarenessUsed.patternIdsRead — never from patterns merely visible in the caller's full context. */
  patternsUsed: PatternUsed[];
  /** Sourced ONLY from decision.reasoningTrace.awarenessUsed.semanticDimensionsRead. */
  playerTraitsUsed: PlayerTraitUsed[];
  /** Sourced ONLY from strategicIntent.awarenessUsed.episodeIdsRead — the Decision Engine itself never reads episodic memory directly (see decision-engine's DecisionInputs); a decision's episodic grounding is inherited from the goal that produced its StrategicIntent. */
  memoriesReferenced: MemoryReferenced[];
  confidence: ConfidenceReading;
  awarenessTier: AwarenessTier;
  worldFacts: DecisionWorldFacts;
  traceability: TraceabilityMap;
  naturalLanguage: string[];
  schemaVersion: 1;
}

// ---------------------------------------------------------------------------
// Strategy Explanation — "why this GOAL", one layer up from a Decision.
// ---------------------------------------------------------------------------

export interface StrategyExplanation {
  explanationId: string;
  intentId: string;
  matchId: string;
  playerId: string;
  gameId: string;
  generatedAt: number;
  goalId: string;
  goalDisplayName: string;
  goalCategory: GoalCategory;
  personality: PersonalityArchetype;
  plannedSequence: string[];
  chosenCandidate: GoalCandidateTrace;
  rejectedAlternatives: GoalCandidateTrace[];
  confidence: ConfidenceReading;
  awarenessTier: AwarenessTier;
  awarenessUsed: StrategyAwarenessUsed;
  traceability: TraceabilityMap;
  naturalLanguage: string[];
  schemaVersion: 1;
}

// ---------------------------------------------------------------------------
// Pattern-level Explanation — whitepaper §8's "near-direct readout" tier.
// ---------------------------------------------------------------------------

export interface PatternExplanation {
  explanationId: string;
  playerId: string;
  gameId: string;
  generatedAt: number;
  patternId: string;
  category: string;
  description: string;
  state: PatternEntry['state'];
  confidence: ConfidenceReading;
  traceability: TraceabilityMap;
  naturalLanguage: string[];
  schemaVersion: 1;
}

// ---------------------------------------------------------------------------
// Player Profile Explanation — one or more semantic dimensions, read out
// directly (no cross-match history needed; see BehaviorEvolution for that).
// ---------------------------------------------------------------------------

export interface ProfileDimensionExplanation {
  dimension: string;
  gameId: string | null;
  value: number;
  confidence: ConfidenceReading;
  samples: number;
}

export interface PlayerProfileExplanation {
  explanationId: string;
  playerId: string;
  generatedAt: number;
  dimensions: ProfileDimensionExplanation[];
  traceability: TraceabilityMap;
  naturalLanguage: string[];
  schemaVersion: 1;
}

// ---------------------------------------------------------------------------
// Episode Explanation — one stored episodic memory, read out directly.
// ---------------------------------------------------------------------------

export interface EpisodeExplanation {
  explanationId: string;
  episodeId: string;
  playerId: string;
  gameId: string;
  matchId: string;
  generatedAt: number;
  episodeType: string;
  summary: string;
  importance: number;
  confidence: ConfidenceReading;
  timestamp: number;
  traceability: TraceabilityMap;
  naturalLanguage: string[];
  schemaVersion: 1;
}

// ---------------------------------------------------------------------------
// Match Summary — aggregates every DecisionExplanation from one match.
// ---------------------------------------------------------------------------

export interface GoalCategoryTally {
  category: GoalCategory;
  count: number;
}

export interface MatchSummary {
  explanationId: string;
  matchId: string;
  playerId: string;
  gameId: string;
  generatedAt: number;
  decisionCount: number;
  personality: PersonalityArchetype | null;
  averageUtility: number;
  averageConfidence: ConfidenceReading;
  goalCategoryBreakdown: GoalCategoryTally[];
  distinctPatternsUsed: string[];
  distinctTraitsUsed: string[];
  distinctMemoriesReferenced: string[];
  /** The `maxKeyMoments` decisions with the lowest confidence — the genuinely closest calls, most informative for "what almost happened differently." Ties broken by ascending decisionId. */
  closestCalls: DecisionSummaryRef[];
  /** The `maxKeyMoments` decisions with the highest confidence — the most decisive plays. */
  mostDecisive: DecisionSummaryRef[];
  traceability: TraceabilityMap;
  naturalLanguage: string[];
  schemaVersion: 1;
}

export interface DecisionSummaryRef {
  decisionId: string;
  actionId: string;
  goalId: string;
  utility: number;
  confidence: ConfidenceReading;
}

// ---------------------------------------------------------------------------
// Behavior Evolution — a dimension's value across stored history.
// ---------------------------------------------------------------------------

export type TrendDirection = 'increasing' | 'decreasing' | 'stable';

export interface BehaviorEvolution {
  explanationId: string;
  playerId: string;
  gameId: string | null;
  dimension: string;
  generatedAt: number;
  sampleCount: number;
  firstValue: number;
  lastValue: number;
  delta: number;
  direction: TrendDirection;
  firstObservedAt: number;
  lastObservedAt: number;
  traceability: TraceabilityMap;
  naturalLanguage: string[];
  schemaVersion: 1;
}

// ---------------------------------------------------------------------------
// Confidence Evolution — how sure the platform has become about a claim
// (a semantic dimension OR a pattern) over its own stored history.
// ---------------------------------------------------------------------------

export interface ConfidenceHistoryPoint {
  timestamp: number;
  confidence: number;
}

export interface ConfidenceEvolution {
  explanationId: string;
  playerId: string;
  subjectKind: 'semanticDimension' | 'pattern';
  subjectId: string;
  generatedAt: number;
  sampleCount: number;
  firstConfidence: ConfidenceReading;
  lastConfidence: ConfidenceReading;
  direction: TrendDirection;
  traceability: TraceabilityMap;
  naturalLanguage: string[];
  schemaVersion: 1;
}

// ---------------------------------------------------------------------------
// Match Comparison — "compared to your previous matches..."
// ---------------------------------------------------------------------------

export interface DimensionComparison {
  dimension: string;
  before: number;
  after: number;
  delta: number;
  direction: TrendDirection;
}

export interface MatchComparison {
  explanationId: string;
  playerId: string;
  generatedAt: number;
  beforeMatchId: string;
  afterMatchId: string;
  dimensionDeltas: DimensionComparison[];
  decisionCountDelta: number;
  averageUtilityDelta: number;
  personalityChanged: boolean;
  traceability: TraceabilityMap;
  naturalLanguage: string[];
  schemaVersion: 1;
}

// ---------------------------------------------------------------------------
// Player Insights — strengths/weaknesses/etc., every entry evidence-backed.
// ---------------------------------------------------------------------------

export type InsightCategory = 'strength' | 'weakness' | 'improvingSkill' | 'recurringMistake' | 'emergingHabit' | 'behaviorChange' | 'learningTrend';

export interface PlayerInsight {
  category: InsightCategory;
  subject: string;
  detail: Record<string, unknown>;
  confidence: ConfidenceReading;
  evidence: EvidenceRef[];
}

export interface PlayerInsights {
  explanationId: string;
  playerId: string;
  gameId: string | null;
  generatedAt: number;
  insights: PlayerInsight[];
  traceability: TraceabilityMap;
  naturalLanguage: string[];
  schemaVersion: 1;
}

// ---------------------------------------------------------------------------
// Union type + envelope for the persisted explanation store / API layer.
// ---------------------------------------------------------------------------

export type AnyExplanation =
  | DecisionExplanation
  | StrategyExplanation
  | PatternExplanation
  | PlayerProfileExplanation
  | EpisodeExplanation
  | MatchSummary
  | BehaviorEvolution
  | ConfidenceEvolution
  | MatchComparison
  | PlayerInsights;

export type ExplanationType =
  | 'decision'
  | 'strategy'
  | 'pattern'
  | 'playerProfile'
  | 'episode'
  | 'matchSummary'
  | 'behaviorEvolution'
  | 'confidenceEvolution'
  | 'matchComparison'
  | 'playerInsights';

/** The envelope persisted by ExplanationStore for any explanation type — enables a single `explanationHistory` collection/API rather than one per type. */
export interface StoredExplanation {
  explanationType: ExplanationType;
  playerId: string;
  matchId: string | null;
  gameId: string | null;
  storedAt: number;
  explanation: AnyExplanation;
}
