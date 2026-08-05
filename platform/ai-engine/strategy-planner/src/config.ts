/**
 * Central configuration for Strategy Planner, mirroring the convention
 * every other AI-engine package already uses: every tunable lives here,
 * sourced from environment variables with safe defaults, never hardcoded
 * at a goal's or the planner's call site.
 */

import { GoalCategory, PersonalityArchetype } from './types';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ---------------------------------------------------------------------------
// Awareness Budget — whitepaper §7.
// ---------------------------------------------------------------------------

export interface AwarenessBudgetConfig {
  /** Budget strictly below this value: recent observations only (beginner tier). */
  recentOnlyMaxBudget: number;
  /** Budget strictly below this value (and >= recentOnlyMaxBudget): + Semantic Profile (veteran tier). At/above this value: + confirmed/strong Patterns + Episodic Memory (expert tier). */
  semanticProfileMaxBudget: number;
  /** Minimum pattern state (in lifecycle order) an expert-tier goal is allowed to read — never 'candidate' or 'weakening', matching the whitepaper's "high-confidence patterns" framing. */
  minPatternStateForExpertTier: 'confirmed' | 'strong';
  /** Convenience preset values matching the whitepaper's worked examples — not read by the masking logic itself, only by callers picking a starting budget for a given match-count/experience bucket. */
  presetBudgets: { beginner: number; veteran: number; expert: number };
}

// ---------------------------------------------------------------------------
// Personality — whitepaper §9 (archetype list extended with "Supportive" per
// this phase's explicit instructions).
// ---------------------------------------------------------------------------

export type CategoryWeights = Record<GoalCategory, number>;

export interface PersonalityProfile {
  categoryWeights: CategoryWeights;
  /** Per-goal-id override multiplier, applied ON TOP of the category weight — sparse, only for goals whose personality bias isn't fully captured by their category. */
  goalOverrides: Record<string, number>;
  /** [0,1] — Experimental personality's controlled-exploration term (whitepaper §9): the probability the planner deliberately promotes a lower-scored eligible goal instead of the highest-scoring one. 0 for every non-Experimental personality. */
  explorationEpsilon: number;
}

export type PersonalityConfig = Record<PersonalityArchetype, PersonalityProfile>;

// ---------------------------------------------------------------------------
// GOAP search.
// ---------------------------------------------------------------------------

export interface GoapConfig {
  /** Bounded depth (whitepaper §6: "bounded depth") — how many goals the planner may chain in one plan. */
  maxSearchDepth: number;
  /** Total forward-search node expansions allowed per planning call — the actual computational bound (whitepaper §12.11: "bounded... and rare by design"). */
  nodeBudget: number;
  /** Branching factor cap per depth level — only the top-K scoring eligible goals are expanded further, keeping nodeBudget meaningful even with many registered goals. */
  beamWidth: number;
  /** Per-depth-level score discount (0,1] — a step further in the future is worth less certainty than the immediate one. */
  discountFactor: number;
  /** How long a cached plan remains valid before it's unconditionally replanned, regardless of world-state stability. */
  planTtlMs: number;
}

export interface StrategyPlannerConfig {
  awarenessBudget: AwarenessBudgetConfig;
  personality: PersonalityConfig;
  goap: GoapConfig;
  /** World-state derivation thresholds shared across goals — see world-state.ts. Centralized so tuning one doesn't require touching every goal that reads the resulting fact. */
  worldStateThresholds: {
    healthLow: number;
    resourcesLow: number;
    spaceContested: number;
    predictabilityHighConfidence: number;
    highRiskTolerance: number;
    highAggression: number;
    lowMechanicalSkill: number;
    staleEpisodeWindowMs: number;
  };
  plannerVersion: number;
}

const DEFAULT_CATEGORY_WEIGHTS: CategoryWeights = {
  pressure: 1,
  positioning: 1,
  deception: 1,
  information: 1,
  defense: 1,
  tempo: 1,
};

function weights(overrides: Partial<CategoryWeights>): CategoryWeights {
  return { ...DEFAULT_CATEGORY_WEIGHTS, ...overrides };
}

export function loadStrategyPlannerConfig(overrides: Partial<StrategyPlannerConfig> = {}): StrategyPlannerConfig {
  const base: StrategyPlannerConfig = {
    awarenessBudget: {
      recentOnlyMaxBudget: envFloat('STRATEGY_AWARENESS_RECENT_ONLY_MAX', 0.34),
      semanticProfileMaxBudget: envFloat('STRATEGY_AWARENESS_SEMANTIC_MAX', 0.67),
      minPatternStateForExpertTier: 'confirmed',
      presetBudgets: { beginner: 0.15, veteran: 0.55, expert: 0.9 },
    },

    // Whitepaper §9's table, plus "Supportive" (this phase's explicit
    // addition): weights considerations tied to keeping the player engaged
    // and the match balanced — protect/regroup/positioning favored over
    // pure punishment, distinct from Patient (which is about safety, not
    // player experience) and Defensive (which is about self-preservation).
    personality: {
      aggressive: { categoryWeights: weights({ pressure: 1.8, tempo: 1.4, defense: 0.5 }), goalOverrides: {}, explorationEpsilon: 0 },
      patient: { categoryWeights: weights({ defense: 1.3, positioning: 1.3, pressure: 0.6, tempo: 0.6 }), goalOverrides: {}, explorationEpsilon: 0 },
      hunter: { categoryWeights: weights({ pressure: 1.3, information: 1.3, positioning: 0.7 }), goalOverrides: { scoutUnknownBehavior: 1.4 }, explorationEpsilon: 0 },
      defensive: { categoryWeights: weights({ defense: 1.8, pressure: 0.5, tempo: 0.7 }), goalOverrides: {}, explorationEpsilon: 0 },
      psychological: { categoryWeights: weights({ deception: 1.8, information: 1.2, pressure: 0.9 }), goalOverrides: { createAmbush: 1.4, breakPredictablePattern: 1.3 }, explorationEpsilon: 0 },
      experimental: { categoryWeights: weights({}), goalOverrides: { testHypothesis: 1.5 }, explorationEpsilon: envFloat('STRATEGY_EXPERIMENTAL_EPSILON', 0.15) },
      supportive: { categoryWeights: weights({ defense: 1.2, positioning: 1.1, pressure: 0.7 }), goalOverrides: { protectObjective: 1.3, regroup: 1.3 }, explorationEpsilon: 0 },
    },

    goap: {
      maxSearchDepth: envInt('STRATEGY_GOAP_MAX_DEPTH', 3),
      nodeBudget: envInt('STRATEGY_GOAP_NODE_BUDGET', 60),
      beamWidth: envInt('STRATEGY_GOAP_BEAM_WIDTH', 3),
      discountFactor: envFloat('STRATEGY_GOAP_DISCOUNT', 0.85),
      planTtlMs: envInt('STRATEGY_GOAP_PLAN_TTL_MS', 15_000),
    },

    worldStateThresholds: {
      healthLow: envFloat('STRATEGY_THRESHOLD_HEALTH_LOW', 0.35),
      resourcesLow: envFloat('STRATEGY_THRESHOLD_RESOURCES_LOW', 0.3),
      spaceContested: envFloat('STRATEGY_THRESHOLD_SPACE_CONTESTED', 0.5),
      predictabilityHighConfidence: envFloat('STRATEGY_THRESHOLD_PREDICTABILITY_CONFIDENCE', 0.5),
      highRiskTolerance: envFloat('STRATEGY_THRESHOLD_HIGH_RISK_TOLERANCE', 0.6),
      highAggression: envFloat('STRATEGY_THRESHOLD_HIGH_AGGRESSION', 0.6),
      lowMechanicalSkill: envFloat('STRATEGY_THRESHOLD_LOW_MECHANICAL_SKILL', 0.35),
      staleEpisodeWindowMs: envInt('STRATEGY_STALE_EPISODE_WINDOW_MS', 10 * 60 * 1000),
    },

    plannerVersion: 1,
  };

  return {
    ...base,
    ...overrides,
    awarenessBudget: { ...base.awarenessBudget, ...overrides.awarenessBudget },
    personality: { ...base.personality, ...overrides.personality },
    goap: { ...base.goap, ...overrides.goap },
    worldStateThresholds: { ...base.worldStateThresholds, ...overrides.worldStateThresholds },
  };
}
