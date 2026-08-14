/**
 * Central configuration for Difficulty Calibration, mirroring the
 * convention every other AI-engine package uses (see decision-engine's
 * own config.ts): every tunable lives here, sourced from environment
 * variables with safe defaults, never hardcoded at a call site.
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

export interface AwarenessBudgetConfig {
  /** Awareness Budget for a brand-new player with zero match history — the "deliberate floor" whitepaper §7 requires, independent of profile confidence. */
  newPlayerFloor: number;
  /** Matches played (against this opponent, this game) before the budget reaches its maximum (1.0). Linear ramp between 0 and this count. */
  rampMatchCount: number;
}

export function loadDifficultyCalibrationConfig(overrides: Partial<AwarenessBudgetConfig> = {}): AwarenessBudgetConfig {
  return {
    newPlayerFloor: overrides.newPlayerFloor ?? envFloat('DIFFICULTY_CALIBRATION_NEW_PLAYER_FLOOR', 0.2),
    rampMatchCount: overrides.rampMatchCount ?? envInt('DIFFICULTY_CALIBRATION_RAMP_MATCHES', 5),
  };
}
