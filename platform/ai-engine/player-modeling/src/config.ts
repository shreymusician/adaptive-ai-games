/**
 * Central configuration for Player Modeling, mirroring the
 * @adaptive-ai/memory-engine convention: every tunable lives here, sourced
 * from environment variables with safe defaults, never hardcoded at the call
 * site. Dimension-specific numeric knobs (bucket thresholds, danger
 * thresholds, etc.) also live here rather than inside individual analyzers,
 * so tuning never requires touching analyzer logic.
 */

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

export interface DimensionTuning {
  /** EWMA time-constant `k` for this dimension — whitepaper §3.1: "k is tuned per dimension, not global." */
  k: number;
  /** Minimum in-match evidence gate ([0,1], the analyzer's own `confidence()` reading) below which an observation is not submitted at all this match. */
  minMatchConfidence: number;
}

export interface PlayerModelingConfig {
  /** Per-dimension tuning, keyed by the dimension id used in DimensionAnalyzerMetadata.id. Falls back to `defaultTuning` when a dimension has no entry. */
  dimensionTuning: Record<string, DimensionTuning>;
  defaultTuning: DimensionTuning;
  /** How many prior semantic-dimension versions to fetch for analyzers that declare `historyDependsOn` (e.g. Learning Rate). Bounded — never a full-history scan. */
  historyLookbackVersions: number;
  /** Distance-bucket thresholds (world units, genre-relative) for Preferred Combat Distance. */
  combatDistanceBuckets: { closeMax: number; midMax: number };
  /** payload.dangerLevel / payload.riskLevel at or above this counts as "high-risk" for Risk Tolerance. */
  highRiskThreshold: number;
  /** Minimum |delta| between prior and updated dimension value (on Memory Engine's 0-1-ish confidence-independent scale, normalized per dimension) that qualifies as an episode candidate. */
  episodeCandidateMinDelta: number;
  /** Episode candidates at or above this importance are stored automatically; lower-scored candidates are still returned for visibility but not persisted. */
  episodeAutoStoreImportance: number;
  /** alphaMin used ONLY for the engine's local, DB-free preview computation (analyzer.update() against the prefetched prior snapshot) — never the value actually applied by Memory Engine's own authoritative write. */
  previewAlphaMin: number;
}

export function loadPlayerModelingConfig(overrides: Partial<PlayerModelingConfig> = {}): PlayerModelingConfig {
  const base: PlayerModelingConfig = {
    dimensionTuning: {
      reactionTime: { k: envFloat('PLAYER_MODELING_K_REACTION_TIME', 20), minMatchConfidence: 0.2 },
      decisionSpeed: { k: envFloat('PLAYER_MODELING_K_DECISION_SPEED', 15), minMatchConfidence: 0.2 },
      aggression: { k: envFloat('PLAYER_MODELING_K_AGGRESSION', 10), minMatchConfidence: 0.15 },
      riskTolerance: { k: envFloat('PLAYER_MODELING_K_RISK_TOLERANCE', 10), minMatchConfidence: 0.15 },
      consistency: { k: envFloat('PLAYER_MODELING_K_CONSISTENCY', 15), minMatchConfidence: 0.25 },
      predictability: { k: envFloat('PLAYER_MODELING_K_PREDICTABILITY', 12), minMatchConfidence: 0.25 },
      learningRate: { k: envFloat('PLAYER_MODELING_K_LEARNING_RATE', 25), minMatchConfidence: 0.3 },
      mechanicalSkill: { k: envFloat('PLAYER_MODELING_K_MECHANICAL_SKILL', 15), minMatchConfidence: 0.2 },
      strategicSkill: { k: envFloat('PLAYER_MODELING_K_STRATEGIC_SKILL', 15), minMatchConfidence: 0.1 },
      exploration: { k: envFloat('PLAYER_MODELING_K_EXPLORATION', 12), minMatchConfidence: 0.15 },
      preferredCombatDistance: { k: envFloat('PLAYER_MODELING_K_COMBAT_DISTANCE', 10), minMatchConfidence: 0.15 },
      preferredStrategies: { k: envFloat('PLAYER_MODELING_K_PREFERRED_STRATEGIES', 10), minMatchConfidence: 0.15 },
      confidence: { k: envFloat('PLAYER_MODELING_K_CONFIDENCE', 10), minMatchConfidence: 0.25 },
    },
    defaultTuning: { k: envFloat('PLAYER_MODELING_DEFAULT_K', 10), minMatchConfidence: envFloat('PLAYER_MODELING_DEFAULT_MIN_MATCH_CONFIDENCE', 0.2) },
    historyLookbackVersions: envInt('PLAYER_MODELING_HISTORY_LOOKBACK_VERSIONS', 5),
    combatDistanceBuckets: {
      closeMax: envFloat('PLAYER_MODELING_COMBAT_DISTANCE_CLOSE_MAX', 5),
      midMax: envFloat('PLAYER_MODELING_COMBAT_DISTANCE_MID_MAX', 20),
    },
    highRiskThreshold: envFloat('PLAYER_MODELING_HIGH_RISK_THRESHOLD', 0.6),
    episodeCandidateMinDelta: envFloat('PLAYER_MODELING_EPISODE_MIN_DELTA', 0.25),
    episodeAutoStoreImportance: envFloat('PLAYER_MODELING_EPISODE_AUTO_STORE_IMPORTANCE', 0.6),
    previewAlphaMin: envFloat('PLAYER_MODELING_PREVIEW_ALPHA_MIN', 0.02),
  };

  return {
    ...base,
    ...overrides,
    dimensionTuning: { ...base.dimensionTuning, ...overrides.dimensionTuning },
    defaultTuning: { ...base.defaultTuning, ...overrides.defaultTuning },
    combatDistanceBuckets: { ...base.combatDistanceBuckets, ...overrides.combatDistanceBuckets },
  };
}

export function resolveTuning(config: PlayerModelingConfig, dimensionId: string): DimensionTuning {
  return config.dimensionTuning[dimensionId] ?? config.defaultTuning;
}
