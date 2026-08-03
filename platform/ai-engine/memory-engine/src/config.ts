/**
 * Central configuration for the Memory Engine, mirroring the
 * @adaptive-ai/event-pipeline convention: every tunable lives here, sourced
 * from environment variables with safe defaults, never hardcoded at the call
 * site.
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

export interface ConfidenceConfig {
  /** Default time-constant `k` in `confidence = 1 - e^(-samples/k)`, used when a dimension has no per-dimension override. */
  defaultK: number;
  /** Per-dimension overrides for `k` — whitepaper §3.1: "k is tuned per dimension, not global." */
  dimensionK: Record<string, number>;
  /** Floor for α = 1/(1+samples), so learning never fully stalls even after many samples. */
  alphaMin: number;
  /** Per-day confidence decay rate for the optional gradual-decay sweep (dormant dimensions). 0 disables decay. */
  decayRatePerDay: number;
}

export interface WorkingMemoryConfig {
  /** Ring-buffer capacity for recentObservations — whitepaper §4: "deliberately kept small." */
  maxObservations: number;
  /** A match whose working memory hasn't been touched in this long is considered abandoned by deleteExpiredWorkingMemory(). */
  maxIdleMs: number;
}

export interface ShortTermMemoryConfig {
  maxEvents: number;
  maxBehaviors: number;
  maxDecisions: number;
}

export interface EpisodicMemoryConfig {
  /** Top-K most important episodes retained per (playerId, gameId). */
  maxEpisodesPerPlayerGame: number;
  /** Optional time-based expiry, independent of the top-K cap. undefined = no age limit. */
  maxAgeMs?: number;
}

export interface MemoryEngineConfig {
  confidence: ConfidenceConfig;
  workingMemory: WorkingMemoryConfig;
  shortTermMemory: ShortTermMemoryConfig;
  episodicMemory: EpisodicMemoryConfig;
  /** How many times updateSemanticMemory retries on a concurrent-write conflict before giving up. */
  semanticWriteMaxRetries: number;
}

export function loadMemoryEngineConfig(overrides: Partial<MemoryEngineConfig> = {}): MemoryEngineConfig {
  const base: MemoryEngineConfig = {
    confidence: {
      defaultK: envFloat('MEMORY_ENGINE_CONFIDENCE_DEFAULT_K', 10),
      dimensionK: {},
      alphaMin: envFloat('MEMORY_ENGINE_ALPHA_MIN', 0.02),
      decayRatePerDay: envFloat('MEMORY_ENGINE_DECAY_RATE_PER_DAY', 0.01),
    },
    workingMemory: {
      maxObservations: envInt('MEMORY_ENGINE_WORKING_MAX_OBSERVATIONS', 50),
      maxIdleMs: envInt('MEMORY_ENGINE_WORKING_MAX_IDLE_MS', 6 * 60 * 60 * 1000), // 6h — matches default match-token TTL
    },
    shortTermMemory: {
      maxEvents: envInt('MEMORY_ENGINE_SHORT_TERM_MAX_EVENTS', 500),
      maxBehaviors: envInt('MEMORY_ENGINE_SHORT_TERM_MAX_BEHAVIORS', 200),
      maxDecisions: envInt('MEMORY_ENGINE_SHORT_TERM_MAX_DECISIONS', 200),
    },
    episodicMemory: {
      maxEpisodesPerPlayerGame: envInt('MEMORY_ENGINE_EPISODES_MAX_PER_PLAYER_GAME', 50),
      maxAgeMs: undefined,
    },
    semanticWriteMaxRetries: envInt('MEMORY_ENGINE_SEMANTIC_WRITE_MAX_RETRIES', 5),
  };

  return {
    ...base,
    ...overrides,
    confidence: { ...base.confidence, ...overrides.confidence },
    workingMemory: { ...base.workingMemory, ...overrides.workingMemory },
    shortTermMemory: { ...base.shortTermMemory, ...overrides.shortTermMemory },
    episodicMemory: { ...base.episodicMemory, ...overrides.episodicMemory },
  };
}
