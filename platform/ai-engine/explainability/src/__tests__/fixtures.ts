import { GoalRegistry, registerAllGoals, loadStrategyPlannerConfig, StrategyPlanner, PlanningInputs, StrategicIntent, MatchContext, PublicGameState } from '@adaptive-ai/strategy-planner';
import { DecisionRegistry, registerAllConsiderations, loadDecisionEngineConfig, DecisionEngine, DecisionInputs, Decision, Action } from '@adaptive-ai/decision-engine';
import { PlayerEpisode, SemanticDimensionVersion } from '@adaptive-ai/memory-engine';
import { ExplainabilityConfig, loadExplainabilityConfig } from '../config';
import { ExplanationInputs, PatternEntry, SemanticProfileEntry } from '../types';

export const MATCH_ID = 'match-1';
export const PLAYER_ID = 'player-1';
export const GAME_ID = 'game-1';

export function buildMatchContext(overrides: Partial<MatchContext> = {}): MatchContext {
  return { matchId: MATCH_ID, playerId: PLAYER_ID, gameId: GAME_ID, elapsedMs: 30000, ...overrides };
}

export function buildPublicGameState(overrides: Partial<PublicGameState> = {}): PublicGameState {
  return { selfHealth: 0.8, openingAvailable: true, ...overrides };
}

export function buildSemanticProfile(overrides: Partial<SemanticProfileEntry>[] = []): SemanticProfileEntry[] {
  const base: SemanticProfileEntry[] = [
    { dimension: 'aggression', gameId: GAME_ID, value: 0.85, confidence: 0.8, samples: 40 },
    { dimension: 'mechanicalSkill', gameId: GAME_ID, value: 0.3, confidence: 0.75, samples: 40 },
  ];
  return overrides.length ? overrides.map((o, i) => ({ ...base[i % base.length], ...o })) : base;
}

export function buildPatterns(overrides: Partial<PatternEntry>[] = []): PatternEntry[] {
  const base: PatternEntry[] = [
    { patternId: 'pattern-rushes-low-health', detectorId: 'combat-detector', patternKey: 'rushes-low-health', category: 'combat', state: 'confirmed', confidence: 0.82, description: 'Rushes enemies at low health' },
  ];
  return overrides.length ? overrides.map((o, i) => ({ ...base[i % base.length], ...o })) : base;
}

export function buildEpisodes(overrides: Partial<PlayerEpisode>[] = []): PlayerEpisode[] {
  const base: PlayerEpisode[] = [
    {
      episodeId: 'episode-1',
      playerId: PLAYER_ID,
      gameId: GAME_ID,
      matchId: 'match-0',
      timestamp: 1000,
      episodeType: 'repeated-trap',
      summary: 'Fell for the same ambush twice in match-0',
      importance: 0.9,
      confidence: 0.85,
      referencedEvents: ['evt-1', 'evt-2'],
      createdAt: 1000,
    },
  ];
  return overrides.length ? overrides.map((o, i) => ({ ...base[i % base.length], ...o })) : base;
}

export function buildAction(id: string, params: Record<string, unknown> = {}, legalUntil?: number): Action {
  return { id, params, ...(legalUntil !== undefined ? { legalUntil } : {}) };
}

export function buildLegalActions(): Action[] {
  return [
    buildAction('attack', { tags: ['offensive', 'attack'], countersPatternCategory: 'combat', punishesAggression: true }),
    buildAction('wait', { tags: ['wait', 'observe'] }),
    buildAction('retreat', { tags: ['defensive', 'retreat'] }),
  ];
}

export interface RealStrategicIntentOptions {
  matchContext?: MatchContext;
  publicGameState?: PublicGameState;
  semanticProfile?: SemanticProfileEntry[];
  patterns?: PatternEntry[];
  episodicMemory?: PlayerEpisode[];
  awarenessBudget?: number;
  personality?: PlanningInputs['personality'];
  now?: number;
}

/** Runs the REAL @adaptive-ai/strategy-planner end-to-end to produce a genuine StrategicIntent — used so tests exercise this package against real upstream trace shapes, not just hand-shaped fixtures. */
export function buildRealStrategicIntent(options: RealStrategicIntentOptions = {}): StrategicIntent {
  const registry = new GoalRegistry();
  registerAllGoals(registry);
  const config = loadStrategyPlannerConfig();
  const planner = new StrategyPlanner({ registry, config });

  const inputs: PlanningInputs = {
    matchContext: options.matchContext ?? buildMatchContext(),
    publicGameState: options.publicGameState ?? buildPublicGameState(),
    semanticProfile: options.semanticProfile ?? buildSemanticProfile(),
    patterns: options.patterns ?? buildPatterns(),
    episodicMemory: options.episodicMemory ?? [],
    awarenessBudget: options.awarenessBudget ?? 0.95,
    personality: options.personality ?? 'aggressive',
  };

  return planner.plan(inputs, options.now ?? 10_000);
}

export interface RealDecisionOptions {
  legalActions?: Action[];
  matchContext?: MatchContext;
  publicGameState?: PublicGameState;
  semanticProfile?: SemanticProfileEntry[];
  patterns?: PatternEntry[];
  awarenessBudget?: number;
  now?: number;
}

/** Runs the REAL @adaptive-ai/decision-engine on a given StrategicIntent to produce a genuine Decision. */
export function buildRealDecision(strategicIntent: StrategicIntent, options: RealDecisionOptions = {}): Decision {
  const config = loadDecisionEngineConfig();
  const registry = new DecisionRegistry();
  registerAllConsiderations(registry, config);
  const engine = new DecisionEngine({ registry, config });

  const inputs: DecisionInputs = {
    strategicIntent,
    legalActions: options.legalActions ?? buildLegalActions(),
    matchContext: options.matchContext ?? buildMatchContext(),
    publicGameState: options.publicGameState ?? buildPublicGameState(),
    semanticProfile: options.semanticProfile ?? buildSemanticProfile(),
    patterns: options.patterns ?? buildPatterns(),
    awarenessBudget: options.awarenessBudget ?? strategicIntent.awarenessBudget,
    personality: strategicIntent.personality,
  };

  return engine.decide(inputs, options.now ?? 10_050);
}

export function buildRealExplanationInputs(overrides: Partial<{ strategicIntentOptions: RealStrategicIntentOptions; decisionOptions: RealDecisionOptions; patterns: PatternEntry[]; semanticProfile: SemanticProfileEntry[]; episodes: PlayerEpisode[] }> = {}): ExplanationInputs {
  const patterns = overrides.patterns ?? buildPatterns();
  const semanticProfile = overrides.semanticProfile ?? buildSemanticProfile();
  const episodes = overrides.episodes ?? buildEpisodes();

  const strategicIntent = buildRealStrategicIntent({ patterns, semanticProfile, ...overrides.strategicIntentOptions });
  const decision = buildRealDecision(strategicIntent, { patterns, semanticProfile, ...overrides.decisionOptions });

  return { decision, strategicIntent, semanticProfile, patterns, episodes };
}

export function buildSemanticDimensionHistory(dimension: string, values: number[], startTs = 0, stepMs = 86_400_000): SemanticDimensionVersion[] {
  return values.map((value, i) => ({
    playerId: PLAYER_ID,
    gameId: GAME_ID,
    dimension,
    value,
    confidence: 0.7,
    samples: 10 + i,
    version: i + 1,
    updatedAt: startTs + i * stepMs,
  }));
}

export function testConfig(overrides: Partial<ExplainabilityConfig> = {}): ExplainabilityConfig {
  return loadExplainabilityConfig(overrides);
}
