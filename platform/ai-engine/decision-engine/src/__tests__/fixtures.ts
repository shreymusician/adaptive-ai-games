import { loadDecisionEngineConfig, DecisionEngineConfig } from '../config';
import { DecisionRegistry } from '../registry';
import { registerAllConsiderations } from '../considerations';
import { DecisionEngine } from '../decision-engine';
import { Action, AwarenessUsedAccumulator, ConsiderationContext, DecisionInputs, DecisionWorldFacts, MaskedDecisionInputs, StrategicIntent } from '../types';

export function buildStrategicIntent(overrides: Partial<StrategicIntent> = {}): StrategicIntent {
  return {
    intentId: 'intent-1',
    matchId: 'match-1',
    playerId: 'player-1',
    gameId: 'game-1',
    goalId: 'pressurePlayer',
    goalDisplayName: 'Pressure Player',
    category: 'pressure',
    confidence: 0.7,
    plannedSequence: [],
    personality: 'aggressive',
    awarenessBudget: 0.9,
    awarenessUsed: { tier: 'expert', budget: 0.9, usedRecentObservations: true, usedSemanticProfile: true, usedPatterns: true, usedEpisodicMemory: false, semanticDimensionsRead: [], patternIdsRead: [], episodeIdsRead: [] },
    planningMetadata: { plannerVersion: 1, searchDepthUsed: 1, maxSearchDepth: 3, nodesExpanded: 14, nodeBudget: 60, beamWidth: 3, cacheHit: false, replanned: true, interruptedGoalId: null, candidateCount: 14, planningDurationMs: 1 },
    planningTrace: { worldState: {}, candidates: [], planSequence: [], rejectedEligible: [] },
    generatedAt: 1000,
    validUntil: 16000,
    ...overrides,
  };
}

export function buildAction(id: string, overrides: Partial<Action> = {}): Action {
  return { id, params: {}, ...overrides };
}

export function baseDecisionInputs(overrides: Partial<DecisionInputs> = {}): DecisionInputs {
  return {
    strategicIntent: buildStrategicIntent(),
    legalActions: [buildAction('attack'), buildAction('wait')],
    matchContext: { matchId: 'match-1', playerId: 'player-1', gameId: 'game-1', elapsedMs: 5000 },
    publicGameState: {},
    semanticProfile: [],
    patterns: [],
    awarenessBudget: 0.9,
    personality: 'aggressive',
    ...overrides,
  };
}

export function buildRegistry(config: DecisionEngineConfig = loadDecisionEngineConfig()): DecisionRegistry {
  const registry = new DecisionRegistry();
  registerAllConsiderations(registry, config);
  return registry;
}

export function buildConfig(overrides: Partial<DecisionEngineConfig> = {}): DecisionEngineConfig {
  return loadDecisionEngineConfig(overrides);
}

export function buildEngine(configOverrides: Partial<DecisionEngineConfig> = {}): DecisionEngine {
  const config = buildConfig(configOverrides);
  return new DecisionEngine({ registry: buildRegistry(config), config });
}

export function makeAwarenessAccumulator(overrides: Partial<AwarenessUsedAccumulator> = {}): AwarenessUsedAccumulator {
  return {
    tier: 'expert',
    budget: 0.9,
    usedSemanticProfile: true,
    usedPatterns: true,
    semanticDimensionsRead: new Set(),
    patternIdsRead: new Set(),
    ...overrides,
  };
}

/** Builds a ConsiderationContext directly — for testing one consideration's evaluate() in isolation, bypassing masking/world-fact building. */
export function makeConsiderationCtx(action: Action, worldFacts: DecisionWorldFacts, overrides: Partial<MaskedDecisionInputs> = {}, now: number = 1000): ConsiderationContext {
  const maskedDefaults: MaskedDecisionInputs = {
    strategicIntent: buildStrategicIntent(),
    matchContext: { matchId: 'match-1', playerId: 'player-1', gameId: 'game-1', elapsedMs: 5000 },
    publicGameState: {},
    semanticProfile: [],
    patterns: [],
    awarenessBudget: 0.9,
    personality: 'aggressive',
  };
  return {
    action,
    now,
    inputs: { ...maskedDefaults, ...overrides },
    worldFacts,
    awarenessUsed: makeAwarenessAccumulator(),
    siblingResults: new Map(),
  };
}
