/**
 * Central configuration for the Explainability Engine, mirroring the
 * convention every other AI-engine package already uses: every tunable
 * lives here, sourced from environment variables with safe defaults, never
 * hardcoded at a call site.
 */

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface ConfidenceBucketConfig {
  /** Below this, "low". */
  lowMax: number;
  /** Below this (and >= lowMax), "medium". >= this is "high". */
  mediumMax: number;
}

export interface TrendConfig {
  /** Minimum absolute delta between first and last value to call it "increasing"/"decreasing" rather than "stable" — avoids reading noise as a trend. */
  stableEpsilon: number;
}

/**
 * Evidence-only classification used by PlayerInsights to decide whether a
 * semantic dimension reads as a "strength"/"weakness" candidate. A
 * dimension absent from this map is never classified — insights are only
 * ever generated from dimensions this config explicitly declares an
 * interpretation for, never guessed (whitepaper §8: "never invents
 * reasons"). Defaults cover the whitepaper §11 cross-game-transferable
 * dimension names; a genre-specific dimension a plugin introduces stays
 * unclassified (excluded from strengths/weaknesses, never defaulted) unless
 * a caller extends this map via config overrides.
 */
export type DimensionPolarity = 'positive' | 'negative';
export type DimensionPolarityMap = Record<string, DimensionPolarity>;

const DEFAULT_DIMENSION_POLARITY: DimensionPolarityMap = {
  mechanicalSkill: 'positive',
  strategicThinking: 'positive',
  decisionSpeed: 'positive',
  reactionTime: 'positive',
  panicThreshold: 'negative',
};

export interface ExplainabilityConfig {
  confidenceBuckets: ConfidenceBucketConfig;
  trend: TrendConfig;
  dimensionPolarity: DimensionPolarityMap;
  /** Pattern categories PlayerInsights treats as candidates for "recurringMistake" — empty by default (never guessed at which categories are "bad" without the caller declaring it). */
  mistakePatternCategories: string[];
  /** How many closest-call / most-decisive decisions MatchSummary surfaces. */
  maxKeyMoments: number;
  /** Minimum |value| a dimension must reach before PlayerInsights calls it "high"/engaged enough to be worth surfacing as a strength/weakness — avoids reading a barely-observed near-neutral value as an insight. */
  insightValueThreshold: number;
  /** Minimum confidence a dimension/pattern must reach before it's surfaced in PlayerInsights at all. */
  insightMinConfidence: number;
  engineVersion: number;
}

export function loadExplainabilityConfig(overrides: Partial<ExplainabilityConfig> = {}): ExplainabilityConfig {
  const base: ExplainabilityConfig = {
    confidenceBuckets: {
      lowMax: envFloat('EXPLAIN_CONFIDENCE_LOW_MAX', 0.4),
      mediumMax: envFloat('EXPLAIN_CONFIDENCE_MEDIUM_MAX', 0.7),
    },
    trend: {
      stableEpsilon: envFloat('EXPLAIN_TREND_STABLE_EPSILON', 0.05),
    },
    dimensionPolarity: { ...DEFAULT_DIMENSION_POLARITY },
    mistakePatternCategories: [],
    maxKeyMoments: envInt('EXPLAIN_MAX_KEY_MOMENTS', 3),
    insightValueThreshold: envFloat('EXPLAIN_INSIGHT_VALUE_THRESHOLD', 0.6),
    insightMinConfidence: envFloat('EXPLAIN_INSIGHT_MIN_CONFIDENCE', 0.5),
    engineVersion: 1,
  };

  return {
    ...base,
    ...overrides,
    confidenceBuckets: { ...base.confidenceBuckets, ...overrides.confidenceBuckets },
    trend: { ...base.trend, ...overrides.trend },
    dimensionPolarity: { ...base.dimensionPolarity, ...overrides.dimensionPolarity },
    mistakePatternCategories: overrides.mistakePatternCategories ?? base.mistakePatternCategories,
  };
}
