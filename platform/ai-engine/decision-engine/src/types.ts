/**
 * Decision Engine domain types — ADAPTIVE_AI_ENGINE_WHITEPAPER.md §6
 * (Layer 2: "Utility AI. Score every currently-legal action ... against a
 * fixed set of considerations ... Highest (or weighted-random) score wins,
 * submitted through the SDK's decision channel.")
 *
 * The Decision Engine answers exactly one question: "given the current
 * Strategic Intent and the legal actions available, which action should the
 * AI execute?" It never plans (that's Strategy Planner's job, one layer up)
 * and never talks to a plugin directly (that's the SDK Host's job, one
 * layer below) — it only scores and selects among an already-provided list
 * of legal `Action`s.
 *
 * Like @adaptive-ai/strategy-planner, this package deliberately imports its
 * shared input types (SemanticProfileEntry, PatternEntry, MatchContext,
 * PublicGameState, PersonalityArchetype) from strategy-planner rather than
 * redefining them — they are the SAME "legal knowledge" concepts at both
 * planning layers, and StrategicIntent is the one legitimate, designed
 * hand-off object between the two (whitepaper: "passes intent, never raw
 * state"), so importing it directly (rather than mirroring it) is
 * consistent with how Pattern Recognition already imports Player Modeling's
 * PlayerModelingRunResult type directly as an allowed input.
 *
 * `Action` is imported from @adaptive-ai/sdk-protocol — the ONE real
 * cross-boundary dependency this package needs, because "never invent
 * actions, only ever select from what the Plugin SDK exposes" is
 * meaningless without the real Action shape to select from.
 */

import { Action } from '@adaptive-ai/sdk-protocol';
import {
  StrategicIntent,
  SemanticProfileEntry,
  PatternEntry,
  MatchContext,
  PublicGameState,
  PersonalityArchetype,
  AwarenessTier,
  GoalCategory,
} from '@adaptive-ai/strategy-planner';

export type { Action, StrategicIntent, SemanticProfileEntry, PatternEntry, MatchContext, PublicGameState, PersonalityArchetype, AwarenessTier, GoalCategory };

// ---------------------------------------------------------------------------
// Inputs — the closed set of seven things the Decision Engine may read.
// ---------------------------------------------------------------------------

/**
 * Everything one decide() call is given. `legalActions` is deliberately
 * typed `unknown` rather than `Action[]` — the whole point of the
 * "Plugin returns malformed actions" failure case is that this boundary
 * crosses a trust line (a third-party plugin), so the engine must validate
 * before trusting the shape, never assume it.
 */
export interface DecisionInputs {
  strategicIntent: StrategicIntent;
  legalActions: unknown;
  matchContext: MatchContext;
  publicGameState: PublicGameState;
  semanticProfile: SemanticProfileEntry[];
  patterns: PatternEntry[];
  awarenessBudget: number;
  personality: PersonalityArchetype;
}

// ---------------------------------------------------------------------------
// Considerations — the Utility AI scoring units (whitepaper §6's
// "considerations"), registered in the DecisionRegistry.
// ---------------------------------------------------------------------------

export type ConsiderationCategory = 'planAdherence' | 'tactical' | 'safety' | 'exploit' | 'mechanical';

export interface ConsiderationMetadata {
  id: string;
  displayName: string;
  category: ConsiderationCategory;
  /** Bumped whenever this consideration's scoring logic changes in a way that makes historical ReasoningTrace entries non-comparable. */
  version: number;
  /** Other consideration ids whose THIS-EVALUATION result this consideration reads via ConsiderationContext.siblingResults. */
  dependsOn?: string[];
  description: string;
}

/** Symbolic facts derived from PublicGameState/MatchContext — the Decision Engine's own small analog of Strategy Planner's AbstractWorldState, built fresh per decide() call (never reused across calls; tick-cadence state, not match-cadence). */
export type DecisionFactValue = boolean | number;
export type DecisionWorldFacts = Readonly<Record<string, DecisionFactValue>>;

/** Mutable accumulator considerations write into during one decide() call — frozen into AwarenessUsed on the resulting Decision, same convention as strategy-planner's AwarenessUsedAccumulator. */
export interface AwarenessUsedAccumulator {
  tier: AwarenessTier;
  budget: number;
  usedSemanticProfile: boolean;
  usedPatterns: boolean;
  semanticDimensionsRead: Set<string>;
  patternIdsRead: Set<string>;
}

export interface AwarenessUsed {
  tier: AwarenessTier;
  budget: number;
  usedSemanticProfile: boolean;
  usedPatterns: boolean;
  semanticDimensionsRead: string[];
  patternIdsRead: string[];
}

/** Awareness-masked subset of DecisionInputs a consideration is permitted to read this call. */
export interface MaskedDecisionInputs {
  strategicIntent: StrategicIntent;
  matchContext: MatchContext;
  publicGameState: PublicGameState;
  semanticProfile: SemanticProfileEntry[];
  patterns: PatternEntry[];
  awarenessBudget: number;
  personality: PersonalityArchetype;
}

export interface ConsiderationContext {
  action: Action;
  /** The decide() call's own clock reading — used by mechanical/time-sensitive considerations (e.g. ActionFreshness reading Action.legalUntil). Never Date.now() called ad hoc inside a consideration, so a replayed decide() call with the same `now` is fully reproducible. */
  now: number;
  inputs: MaskedDecisionInputs;
  worldFacts: DecisionWorldFacts;
  awarenessUsed: AwarenessUsedAccumulator;
  /** Results already produced earlier THIS ACTION's evaluation pass by considerations declared in `dependsOn`. */
  siblingResults: ReadonlyMap<string, ConsiderationResult>;
}

export interface ConsiderationResult {
  considerationId: string;
  /** [0,1] — this consideration's raw score for this action, BEFORE personality weighting. 0.5 is the documented neutral value a consideration returns when it has no opinion (e.g. the plugin never populated the optional field it looks for) — never silently defaulted to 0 or 1, which would read as a strong opinion it doesn't actually have. */
  value: number;
  reasoning: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Scoring / selection outputs.
// ---------------------------------------------------------------------------

export interface ActionScore {
  action: Action;
  /** [0,1] — the final personality-weighted combination of every consideration's value for this action. */
  utility: number;
  breakdown: ConsiderationResult[];
}

// ---------------------------------------------------------------------------
// Decision — the ONLY output of this package (plus its constituent parts,
// each independently exported per this phase's OUTPUTS requirement).
// ---------------------------------------------------------------------------

export interface DecisionScore {
  utility: number;
  /** [0,1] — normalized margin between the winning and runner-up action's utility, same "decisive vs. close call" semantics as Strategy Planner's GoalConfidence. */
  confidence: number;
  breakdown: ConsiderationResult[];
}

export interface AlternativeCandidate {
  actionId: string;
  utility: number;
  /** 1-based rank among ALL legal actions considered, 1 = the winner itself (included for a complete ranking, not just "the losers"). */
  rank: number;
}

export type TieBreakMode = 'none' | 'deterministic-id-order' | 'exploration';

export interface DecisionMetadata {
  engineVersion: number;
  actionsConsidered: number;
  actionsSkippedMalformed: number;
  evaluationDurationMs: number;
  timedOut: boolean;
  tieBreak: TieBreakMode;
  awarenessTier: AwarenessTier;
  personality: PersonalityArchetype;
}

export interface ReasoningTrace {
  strategicIntentGoalId: string;
  worldFacts: DecisionWorldFacts;
  /** Resolved personality weight per consideration category actually used this decision. */
  considerationWeights: Record<string, number>;
  /** Every action's utility + full consideration breakdown, capped at `config.maxTracedActions` (highest-utility actions first) to keep the trace bounded for large legal-action sets — see README "Known limitations". */
  perActionBreakdown: Array<{ actionId: string; utility: number; considerations: ConsiderationResult[] }>;
  perActionBreakdownTruncated: boolean;
  awarenessUsed: AwarenessUsed;
}

export interface Decision {
  decisionId: string;
  matchId: string;
  playerId: string;
  gameId: string;
  action: Action;
  score: DecisionScore;
  alternatives: AlternativeCandidate[];
  metadata: DecisionMetadata;
  reasoningTrace: ReasoningTrace;
  executionTimestamp: number;
}
