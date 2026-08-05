/**
 * Central configuration for the Decision Engine, mirroring the convention
 * every other AI-engine package already uses: every tunable lives here,
 * sourced from environment variables with safe defaults, never hardcoded
 * at a consideration's or the engine's call site.
 */

import { ConsiderationCategory, PersonalityArchetype } from './types';

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
// Awareness Budget — same tier mechanism as @adaptive-ai/strategy-planner,
// independently configurable (a future Difficulty Calibration module may
// tune the two layers differently), defaulted to the same thresholds for
// consistency between the two planning layers out of the box.
// ---------------------------------------------------------------------------

export interface AwarenessBudgetConfig {
  recentOnlyMaxBudget: number;
  semanticProfileMaxBudget: number;
}

// ---------------------------------------------------------------------------
// Personality — whitepaper §9, this phase's requested archetype list
// (Hunter, Aggressive, Patient, Psychological, Experimental, Supportive,
// Defensive), applied as a category-weight multiplier exactly like
// Strategy Planner's personality.ts — never inside a Consideration itself.
// ---------------------------------------------------------------------------

export type CategoryWeights = Record<ConsiderationCategory, number>;

export interface PersonalityProfile {
  categoryWeights: CategoryWeights;
  considerationOverrides: Record<string, number>;
  explorationEpsilon: number;
}

export type PersonalityConfig = Record<PersonalityArchetype, PersonalityProfile>;

// ---------------------------------------------------------------------------
// Decision loop bounds.
// ---------------------------------------------------------------------------

export interface WorldFactThresholds {
  healthLow: number;
  resourcesLow: number;
  highRiskTolerance: number;
  highAggression: number;
  lowMechanicalSkill: number;
  /** How close to expiry (ms remaining on Action.legalUntil) counts as "urgent" for the ActionFreshness consideration. */
  urgentLegalUntilMs: number;
}

export interface DecisionEngineConfig {
  awarenessBudget: AwarenessBudgetConfig;
  personality: PersonalityConfig;
  worldFactThresholds: WorldFactThresholds;
  /** Wall-clock budget for one decide() call, checked between actions — whitepaper §12.11's "real-time-safe" requirement for this tick-cadence layer. Exceeding it stops evaluating further actions and selects deterministically among those already scored (see DecisionMetadata.timedOut). */
  maxEvaluationMs: number;
  /** How many highest-utility actions' full consideration breakdowns are kept in ReasoningTrace.perActionBreakdown — bounded so a large legal-action set never produces an unbounded trace payload. */
  maxTracedActions: number;
  engineVersion: number;
}

const DEFAULT_CATEGORY_WEIGHTS: CategoryWeights = {
  planAdherence: 1,
  tactical: 1,
  safety: 1,
  exploit: 1,
  mechanical: 1,
};

function weights(overrides: Partial<CategoryWeights>): CategoryWeights {
  return { ...DEFAULT_CATEGORY_WEIGHTS, ...overrides };
}

export function loadDecisionEngineConfig(overrides: Partial<DecisionEngineConfig> = {}): DecisionEngineConfig {
  const base: DecisionEngineConfig = {
    awarenessBudget: {
      recentOnlyMaxBudget: envFloat('DECISION_AWARENESS_RECENT_ONLY_MAX', 0.34),
      semanticProfileMaxBudget: envFloat('DECISION_AWARENESS_SEMANTIC_MAX', 0.67),
    },

    personality: {
      // Punish/pressure (tactical) weighted high, safety low — acts on an opening immediately.
      aggressive: { categoryWeights: weights({ tactical: 1.7, safety: 0.5 }), considerationOverrides: {}, explorationEpsilon: 0 },
      // Safety/plan-discipline weighted high, tactical low — waits for a higher-confidence opening on the SAME underlying read.
      patient: { categoryWeights: weights({ safety: 1.3, planAdherence: 1.3, tactical: 0.6 }), considerationOverrides: {}, explorationEpsilon: 0 },
      // Target-tracking/exploit weighted high.
      hunter: { categoryWeights: weights({ exploit: 1.5, tactical: 1.1 }), considerationOverrides: {}, explorationEpsilon: 0 },
      // Mitigation/safety weighted high, tactical low.
      defensive: { categoryWeights: weights({ safety: 1.8, tactical: 0.5 }), considerationOverrides: {}, explorationEpsilon: 0 },
      // Weights considerations tied to the player's own temperament (exploit) high, tactical/baiting moderate-high — targets temperament, not mechanical openings.
      psychological: { categoryWeights: weights({ exploit: 1.6, tactical: 1.2, safety: 0.8 }), considerationOverrides: {}, explorationEpsilon: 0 },
      // Neutral weights + a controlled exploration term (whitepaper §9) — deliberately tries lower-scored actions some fraction of the time.
      experimental: { categoryWeights: weights({}), considerationOverrides: {}, explorationEpsilon: envFloat('DECISION_EXPERIMENTAL_EPSILON', 0.12) },
      // This phase's explicit addition: plan-adherence weighted high (sticks
      // to the Strategy Planner's read rather than opportunistically
      // deviating), moderate safety, low tactical — distinct from Patient
      // (which is about safety specifically) and Defensive (self-preservation).
      supportive: { categoryWeights: weights({ planAdherence: 1.5, safety: 1.1, tactical: 0.6 }), considerationOverrides: {}, explorationEpsilon: 0 },
    },

    worldFactThresholds: {
      healthLow: envFloat('DECISION_THRESHOLD_HEALTH_LOW', 0.35),
      resourcesLow: envFloat('DECISION_THRESHOLD_RESOURCES_LOW', 0.3),
      highRiskTolerance: envFloat('DECISION_THRESHOLD_HIGH_RISK_TOLERANCE', 0.6),
      highAggression: envFloat('DECISION_THRESHOLD_HIGH_AGGRESSION', 0.6),
      lowMechanicalSkill: envFloat('DECISION_THRESHOLD_LOW_MECHANICAL_SKILL', 0.35),
      urgentLegalUntilMs: envInt('DECISION_URGENT_LEGAL_UNTIL_MS', 250),
    },

    maxEvaluationMs: envInt('DECISION_MAX_EVALUATION_MS', 40),
    maxTracedActions: envInt('DECISION_MAX_TRACED_ACTIONS', 10),
    engineVersion: 1,
  };

  return {
    ...base,
    ...overrides,
    awarenessBudget: { ...base.awarenessBudget, ...overrides.awarenessBudget },
    personality: { ...base.personality, ...overrides.personality },
    worldFactThresholds: { ...base.worldFactThresholds, ...overrides.worldFactThresholds },
  };
}
