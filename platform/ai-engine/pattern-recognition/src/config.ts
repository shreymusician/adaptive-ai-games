/**
 * Central configuration for Pattern Recognition, mirroring the
 * @adaptive-ai/memory-engine / @adaptive-ai/player-modeling convention:
 * every tunable lives here, sourced from environment variables with safe
 * defaults, never hardcoded inside a detector.
 */

import { PatternLifecycleThresholds, PatternTuning } from './types';

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

const DEFAULT_LIFECYCLE: PatternLifecycleThresholds = {
  confirmedConfidence: 0.5,
  strongConfidence: 0.8,
  retiredConfidence: 0.15,
};

export interface PatternRecognitionConfig {
  detectorTuning: Record<string, PatternTuning>;
  defaultTuning: PatternTuning;
  /** How many recent episodes to prefetch per run for detectors that want Episodic Memory context. */
  episodeLookback: number;
  /** Per-match evidence gate (detector.confidence()) below which a detector's deltas are still recorded, but flagged — see PlayerModelingEngine's analogous gate for the parallel design. Set to 0 to never skip (patterns accumulate slowly by design; unlike continuous dimensions, even a single opportunity is usually still worth recording). */
  minMatchEvidence: number;
  /** Distance-bucket thresholds (world units, genre-relative) for the Preferred Engagement Distance detector. */
  engagementDistanceBuckets: { closeMax: number; midMax: number };
  /** Health-percent (0-1) bucket edges for Retreat Conditions / Healing Timing, low to high. */
  healthBuckets: number[];
  /** Below this fraction of a low-health-target's health counts as a "low-health" target for Chase Low-Health Enemies. */
  lowHealthThreshold: number;
  /** At/above this isolation reading, a movement event counts as "overextended". */
  overextensionThreshold: number;
  /** At/below this resource-cost ratio, an ability use counts as "conserving" for Resource Conservation. */
  conservingCostRatio: number;
  /** Ability uses fired within this many ms of coming off cooldown count as "immediate" for Ability Usage Timing. */
  immediateUsageWindowMs: number;
  /** Bounded look-ahead window (events) used by Push After Damage to check for an aggressive follow-up after taking damage. */
  pushAfterDamageWindowEvents: number;
}

function makeTuning(k: number, concentrationBaseline: number, overrides: Partial<PatternTuning> = {}): PatternTuning {
  return {
    k,
    concentrationBaseline,
    contradictionDecayRate: overrides.contradictionDecayRate ?? 0.3,
    decayRatePerDay: overrides.decayRatePerDay ?? 0.02,
    lifecycle: overrides.lifecycle ?? DEFAULT_LIFECYCLE,
  };
}

export function loadPatternRecognitionConfig(overrides: Partial<PatternRecognitionConfig> = {}): PatternRecognitionConfig {
  const base: PatternRecognitionConfig = {
    detectorTuning: {
      // Movement — competing-categorical (concentrationBaseline ~ 1/branching-factor)
      dodgeDirection: makeTuning(envFloat('PATTERN_K_DODGE_DIRECTION', 10), 1 / 3),
      escapeRoutes: makeTuning(envFloat('PATTERN_K_ESCAPE_ROUTES', 8), 1 / 3),
      cornerPreference: makeTuning(envFloat('PATTERN_K_CORNER_PREFERENCE', 8), 1 / 4),
      circleStrafing: makeTuning(envFloat('PATTERN_K_CIRCLE_STRAFING', 8), 0.5),
      // Combat
      reloadTiming: makeTuning(envFloat('PATTERN_K_RELOAD_TIMING', 10), 0.5),
      targetPrioritization: makeTuning(envFloat('PATTERN_K_TARGET_PRIORITIZATION', 8), 1 / 3),
      engagementDistance: makeTuning(envFloat('PATTERN_K_ENGAGEMENT_DISTANCE', 10), 1 / 3),
      weaponPreference: makeTuning(envFloat('PATTERN_K_WEAPON_PREFERENCE', 8), 1 / 3),
      // Decision
      retreatConditions: makeTuning(envFloat('PATTERN_K_RETREAT_CONDITIONS', 8), 0.5),
      healingTiming: makeTuning(envFloat('PATTERN_K_HEALING_TIMING', 8), 0.5),
      abilityUsageTiming: makeTuning(envFloat('PATTERN_K_ABILITY_USAGE_TIMING', 8), 0.5),
      resourceConservation: makeTuning(envFloat('PATTERN_K_RESOURCE_CONSERVATION', 8), 0.5),
      // Exploration
      routePreference: makeTuning(envFloat('PATTERN_K_ROUTE_PREFERENCE', 8), 1 / 3),
      roomClearingBehavior: makeTuning(envFloat('PATTERN_K_ROOM_CLEARING', 8), 0.5),
      explorationOrder: makeTuning(envFloat('PATTERN_K_EXPLORATION_ORDER', 8), 1 / 3),
      // Risk
      pushAfterDamage: makeTuning(envFloat('PATTERN_K_PUSH_AFTER_DAMAGE', 8), 0.5),
      chaseLowHealth: makeTuning(envFloat('PATTERN_K_CHASE_LOW_HEALTH', 8), 0.5),
      overextension: makeTuning(envFloat('PATTERN_K_OVEREXTENSION', 8), 0.5),
    },
    defaultTuning: makeTuning(envFloat('PATTERN_DEFAULT_K', 10), envFloat('PATTERN_DEFAULT_CONCENTRATION_BASELINE', 0.5)),
    episodeLookback: envInt('PATTERN_EPISODE_LOOKBACK', 10),
    minMatchEvidence: envFloat('PATTERN_MIN_MATCH_EVIDENCE', 0),
    engagementDistanceBuckets: { closeMax: envFloat('PATTERN_ENGAGEMENT_CLOSE_MAX', 5), midMax: envFloat('PATTERN_ENGAGEMENT_MID_MAX', 20) },
    healthBuckets: [0.2, 0.4, 0.6, 0.8],
    lowHealthThreshold: envFloat('PATTERN_LOW_HEALTH_THRESHOLD', 0.3),
    overextensionThreshold: envFloat('PATTERN_OVEREXTENSION_THRESHOLD', 0.6),
    conservingCostRatio: envFloat('PATTERN_CONSERVING_COST_RATIO', 0.3),
    immediateUsageWindowMs: envInt('PATTERN_IMMEDIATE_USAGE_WINDOW_MS', 500),
    pushAfterDamageWindowEvents: envInt('PATTERN_PUSH_AFTER_DAMAGE_WINDOW', 3),
  };

  return {
    ...base,
    ...overrides,
    detectorTuning: { ...base.detectorTuning, ...overrides.detectorTuning },
    defaultTuning: { ...base.defaultTuning, ...overrides.defaultTuning },
    engagementDistanceBuckets: { ...base.engagementDistanceBuckets, ...overrides.engagementDistanceBuckets },
  };
}

/** Buckets a [0,1] health-percent reading using PatternRecognitionConfig.healthBuckets edges, returning a human-readable band label. */
export function healthBand(healthPercent: number, edges: number[]): string {
  const sorted = [...edges].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    if (healthPercent <= sorted[i]) return i === 0 ? `below-${Math.round(sorted[i] * 100)}` : `${Math.round(sorted[i - 1] * 100)}-${Math.round(sorted[i] * 100)}`;
  }
  return `above-${Math.round(sorted[sorted.length - 1] * 100)}`;
}

export function resolveTuning(config: PatternRecognitionConfig, detectorId: string): PatternTuning {
  return config.detectorTuning[detectorId] ?? config.defaultTuning;
}
