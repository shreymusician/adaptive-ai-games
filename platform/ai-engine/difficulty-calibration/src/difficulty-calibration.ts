/**
 * Awareness Budget — whitepaper §7 / this package's own README: a 0-1
 * scalar gating how much of the Player Profile/Pattern Recognition/
 * Strategy Planner's read `decision-engine` is permitted to act on this
 * match. Computed here, consumed by @adaptive-ai/decision-engine and
 * @adaptive-ai/strategy-planner (via LiveRoomAIController) — this module
 * never touches game state or numeric stats itself, only produces the
 * scalar.
 *
 * Formula (linear ramp from a new-player floor to full budget):
 *
 *   budget = floor + (1 - floor) * min(recentMatchCount / rampMatchCount, 1)
 *
 * A brand-new player (recentMatchCount = 0) gets exactly `floor`. Budget
 * rises linearly with accumulated match history against this opponent and
 * reaches 1.0 once `rampMatchCount` matches have been played — the
 * "rises with the player's own accumulated history" requirement from the
 * whitepaper, kept intentionally simple: match count is the only signal,
 * no confidence weighting or win/loss shaping, since the specification
 * does not define a more specific formula.
 */
import { AwarenessBudgetConfig, loadDifficultyCalibrationConfig } from './config';

export interface AwarenessBudgetInput {
  /** How many past matches this player has against this opponent/game — MemoryEngine.loadPlayerMemory's own `recentMatches.length`, already scoped to this gameId by the caller. */
  recentMatchCount: number;
}

export function computeAwarenessBudget(input: AwarenessBudgetInput, config: AwarenessBudgetConfig = loadDifficultyCalibrationConfig()): number {
  const { newPlayerFloor, rampMatchCount } = config;
  const progress = rampMatchCount > 0 ? Math.min(Math.max(input.recentMatchCount, 0) / rampMatchCount, 1) : 1;
  const budget = newPlayerFloor + (1 - newPlayerFloor) * progress;
  return Math.min(Math.max(budget, 0), 1);
}
