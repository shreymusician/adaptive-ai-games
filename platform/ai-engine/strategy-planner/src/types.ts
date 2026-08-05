/**
 * Strategy Planner domain types — ADAPTIVE_AI_ENGINE_WHITEPAPER.md §6
 * (Layer 1: "GOAP-style forward search, bounded depth, over a small
 * ABSTRACT action space") and §7 (Awareness Budget).
 *
 * Strategy Planner answers exactly one question: "what objective should the
 * AI pursue next?" It never selects a gameplay action, never touches a
 * plugin, never mutates game state. Its only output is StrategicIntent — an
 * abstract goal (plus a short lookahead sequence) for a future Decision
 * Engine to translate into legal actions. That translation is explicitly
 * out of scope here.
 *
 * This package intentionally defines its OWN narrow input types below
 * rather than importing @adaptive-ai/memory-engine's or
 * @adaptive-ai/pattern-recognition's richer domain types. Two reasons:
 *   1. The boundary ("only these seven inputs, nothing else") is enforced
 *      by the type system itself — there is no field on PlanningInputs a
 *      goal could reach through to find something it shouldn't see.
 *   2. This package has zero runtime dependency on any DB-touching module,
 *      which is what "remain completely independent of gameplay execution"
 *      concretely means at the code level, not just architecturally.
 * A future orchestration wiring (out of scope for this phase, same as the
 * Decision Engine itself) is responsible for translating Memory
 * Engine/Pattern Recognition's real output into these shapes.
 */

// ---------------------------------------------------------------------------
// Inputs — the ONLY seven things a Goal is ever allowed to read.
// ---------------------------------------------------------------------------

/** One dimension from Player Modeling's Semantic Profile (whitepaper §3) — legal, already-persisted, already-consented-to knowledge about the player. */
export interface SemanticProfileEntry {
  dimension: string;
  gameId: string | null;
  value: number;
  confidence: number;
  samples: number;
}

/** One confirmed/strong/weakening pattern from Pattern Recognition (whitepaper §5) — never a raw event, always an already-evaluated claim. */
export interface PatternEntry {
  patternId: string;
  detectorId: string;
  patternKey: string;
  category: string;
  state: 'candidate' | 'confirmed' | 'strong' | 'weakening' | 'retired';
  confidence: number;
  description: string;
}

/** One notable episode from Episodic Memory — a caller-supplied, already-scored (importance, confidence) prior encounter, never a raw event log. */
export interface EpisodicMemoryEntry {
  episodeId: string;
  episodeType: string;
  summary: string;
  importance: number;
  confidence: number;
  timestamp: number;
}

/** Static/slow-changing facts about the current match — never per-tick hidden state, only what any spectator could legitimately know. */
export interface MatchContext {
  matchId: string;
  playerId: string;
  gameId: string;
  elapsedMs: number;
  /** Free-form, plugin-declared match phase (e.g. "early", "mid", "late", "overtime") — opaque to every goal, used only for precondition checks that explicitly opt in. */
  phase?: string;
}

/**
 * Current PUBLIC game state — legal information only, e.g. what a plugin's
 * manifest declares observable (own health, own resources, player-visible
 * objective status). This is deliberately NOT the plugin's full internal
 * state; a plugin decides what's legally "public" the same way it decides
 * what's a legal action. Strategy Planner never receives anything else.
 */
export interface PublicGameState {
  /** [0,1] — the AI-controlled side's own health/integrity, if the genre has one. Undefined for genres without a meaningful health concept. */
  selfHealth?: number;
  /** [0,1] — the player's own health, IF the genre publicly exposes it (e.g. a visible HP bar) — never inferred from hidden state. */
  playerHealthVisible?: number;
  /** [0,1] — how contested/valuable the current spatial position is, plugin-reported. */
  spaceContested?: number;
  /** [0,1] — how depleted the AI's own consumable resources are (ammo, cooldowns, mana). */
  selfResourcesLow?: number;
  /** True if the plugin reports a live objective (flag, point, artifact) under threat. */
  objectiveThreatened?: boolean;
  /** True if the plugin reports the player currently retreating/disengaging. */
  playerRetreating?: boolean;
  /** True if the plugin reports the AI currently has a tactical opening (e.g. player reloading, player out of position). */
  openingAvailable?: boolean;
  /** Free-form additional public facts a genre-specific plugin wants to expose, opt-in per goal (see WorldStateBuilder). Never assumed present. */
  extra?: Record<string, boolean | number>;
}

/** ADAPTIVE_AI_ENGINE_WHITEPAPER.md §9 — a named preset of planning-priority weights, never a memory or player-model mutation. */
export const PERSONALITY_ARCHETYPES = ['hunter', 'aggressive', 'defensive', 'psychological', 'patient', 'experimental', 'supportive'] as const;
export type PersonalityArchetype = (typeof PERSONALITY_ARCHETYPES)[number];

export const isPersonalityArchetype = (value: unknown): value is PersonalityArchetype =>
  typeof value === 'string' && (PERSONALITY_ARCHETYPES as readonly string[]).includes(value);

/**
 * Everything a planning run is given, in one place — the complete, closed
 * set of legal inputs (whitepaper §6/§7). A goal that needs something not
 * listed here cannot be implemented without changing this type, which is
 * the enforcement mechanism for "never access hidden game state."
 */
export interface PlanningInputs {
  matchContext: MatchContext;
  publicGameState: PublicGameState;
  semanticProfile: SemanticProfileEntry[];
  patterns: PatternEntry[];
  episodicMemory: EpisodicMemoryEntry[];
  /** [0,1] — see awareness-budget.ts. Supplied by the caller (future Difficulty Calibration module), not computed inside a goal. */
  awarenessBudget: number;
  personality: PersonalityArchetype;
}

// ---------------------------------------------------------------------------
// Abstract World State — the GOAP search space. Purely symbolic, derived
// ONLY from PlanningInputs (after awareness masking), never raw hidden data.
// ---------------------------------------------------------------------------

export type WorldFactValue = boolean | number;

/** A flat bag of symbolic facts a Goal's preconditions/effects reason over — deliberately not a typed struct, so new goals can introduce new facts without touching this file (whitepaper's "future goals require no changes to existing planner code"). */
export type AbstractWorldState = Readonly<Record<string, WorldFactValue>>;

// ---------------------------------------------------------------------------
// Goal evaluation — what every independent Goal module produces.
// ---------------------------------------------------------------------------

export type GoalCategory = 'pressure' | 'positioning' | 'deception' | 'information' | 'defense' | 'tempo';

export interface GoalMetadata {
  id: string;
  displayName: string;
  category: GoalCategory;
  /** Bumped whenever this goal's evaluation logic changes in a way that makes historical PlanningTrace entries non-comparable to new ones. */
  version: number;
  /** Other goal ids whose evaluation this goal reads via GoalEvaluationContext.siblingResults — topologically ordered by the registry, same convention as player-modeling's DimensionRegistry/pattern-recognition's PatternRegistry. */
  dependsOn?: string[];
  /** Goals with a higher interruptPriority can force a replan mid-plan even when a cached plan is otherwise still valid (see plan-cache.ts). 0 = never interrupts. */
  interruptPriority: number;
  description: string;
}

/**
 * The full context a Goal's evaluate() receives — masked PlanningInputs,
 * the current AbstractWorldState, and sibling results already computed
 * this run. Deliberately excludes personality: whitepaper §9 is explicit
 * that personality "should only influence planning priorities" — it is
 * applied exactly once, by the GOAP planner, as a multiplier on an
 * already-computed utility score (see goap-planner.ts's scoreCandidates).
 * No goal ever sees or reasons about which personality is active.
 */
export interface GoalEvaluationContext {
  inputs: PlanningInputs;
  worldState: AbstractWorldState;
  /** AwarenessUsed accumulator so far this run — goals report which specific memory items they actually read (see awareness-budget.ts). */
  awarenessUsed: AwarenessUsedAccumulator;
  /** Results already produced earlier in this run by goals this goal declared in `dependsOn`. */
  siblingResults: ReadonlyMap<string, GoalEvaluationResult>;
}

/** What one Goal produces for one evaluation — never a gameplay action, always about the goal itself. */
export interface GoalEvaluationResult {
  goalId: string;
  /** [0,1] — this goal's raw desirability given current inputs, BEFORE personality weighting. */
  utility: number;
  /** [0,1] — this goal's estimated risk/resource cost if pursued. */
  cost: number;
  preconditionsMet: boolean;
  /** Declarative facts this goal expects to become true if pursued to completion — the GOAP effect set used to simulate the next planning step. */
  expectedEffects: AbstractWorldState;
  /** Free-form, goal-specific reasoning inputs (which facts/dimensions/patterns drove the utility number) — feeds PlanningTrace, never natural language. */
  reasoning: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Awareness Budget — whitepaper §7.
// ---------------------------------------------------------------------------

export type AwarenessTier = 'beginner' | 'veteran' | 'expert';

/** Mutable accumulator goals write into during one evaluation pass — frozen into AwarenessUsed on the resulting StrategicIntent. */
export interface AwarenessUsedAccumulator {
  tier: AwarenessTier;
  budget: number;
  usedRecentObservations: boolean;
  usedSemanticProfile: boolean;
  usedPatterns: boolean;
  usedEpisodicMemory: boolean;
  /** Specific dimension names actually read by any goal this run — not just "visible", genuinely consumed. */
  semanticDimensionsRead: Set<string>;
  /** Specific pattern ids actually read by any goal this run. */
  patternIdsRead: Set<string>;
  /** Specific episode ids actually read by any goal this run. */
  episodeIdsRead: Set<string>;
}

/** The frozen, serializable form attached to a StrategicIntent — same fields as the accumulator, Sets converted to arrays. */
export interface AwarenessUsed {
  tier: AwarenessTier;
  budget: number;
  usedRecentObservations: boolean;
  usedSemanticProfile: boolean;
  usedPatterns: boolean;
  usedEpisodicMemory: boolean;
  semanticDimensionsRead: string[];
  patternIdsRead: string[];
  episodeIdsRead: string[];
}

// ---------------------------------------------------------------------------
// GOAP planning trace — structured reasoning data for Explainability
// (whitepaper §8) to later read out deterministically. No natural language.
// ---------------------------------------------------------------------------

export interface GoalCandidateTrace {
  goalId: string;
  utility: number;
  cost: number;
  personalityWeight: number;
  score: number;
  preconditionsMet: boolean;
  reasoning: Record<string, unknown>;
}

export interface PlanStepTrace {
  goalId: string;
  worldStateBefore: AbstractWorldState;
  expectedEffects: AbstractWorldState;
  score: number;
}

export interface PlanningTrace {
  worldState: AbstractWorldState;
  /** Every goal that was evaluated this run, in registry execution order — including ones whose preconditions failed. */
  candidates: GoalCandidateTrace[];
  /** The selected multi-step sequence, in order, first entry is the chosen current goal. */
  planSequence: PlanStepTrace[];
  /** goalIds that had preconditionsMet === true but were not chosen, with their score, for "why not X" explainability. */
  rejectedEligible: GoalCandidateTrace[];
}

export interface PlanningMetadata {
  plannerVersion: number;
  searchDepthUsed: number;
  maxSearchDepth: number;
  nodesExpanded: number;
  nodeBudget: number;
  beamWidth: number;
  cacheHit: boolean;
  replanned: boolean;
  /** Set only when a higher-interruptPriority goal preempted an in-progress cached plan. */
  interruptedGoalId: string | null;
  candidateCount: number;
  planningDurationMs: number;
}

/** [0,1] — confidence in the CHOSEN goal, distinct from that goal's own utility: derived from the normalized margin between the winning and runner-up score (a decisive win => high confidence; a close call => low confidence even if the winning utility itself was high). */
export type GoalConfidence = number;

// ---------------------------------------------------------------------------
// StrategicIntent — the ONLY output of this package.
// ---------------------------------------------------------------------------

export interface StrategicIntent {
  intentId: string;
  matchId: string;
  playerId: string;
  gameId: string;
  goalId: string;
  goalDisplayName: string;
  category: GoalCategory;
  confidence: GoalConfidence;
  /** Lookahead — goal ids planned to follow the current one, if the plan continues to hold (whitepaper §9's Tactical-personality "plan adherence" reads this). */
  plannedSequence: string[];
  personality: PersonalityArchetype;
  awarenessBudget: number;
  awarenessUsed: AwarenessUsed;
  planningMetadata: PlanningMetadata;
  planningTrace: PlanningTrace;
  generatedAt: number;
  /** This intent should be treated as stale after this timestamp even if nothing else invalidated it — see plan-cache.ts. */
  validUntil: number;
}
