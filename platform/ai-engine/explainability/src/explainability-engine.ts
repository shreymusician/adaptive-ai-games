/**
 * ExplainabilityEngine — the public orchestrator: wires the pure explainer
 * functions (decision-explainer.ts, strategy-explainer.ts, ...) to
 * ExplanationStore for persistence and history/timeline/comparison
 * queries. Contains no explanation-generation logic of its own — every
 * `explainX` method is a thin `pureExplainer(...) -> store.store(...)`
 * pair, same "orchestrator with no AI logic of its own" convention as
 * @adaptive-ai/decision-engine's DecisionEngine class.
 */

import { ExplainabilityConfig, loadExplainabilityConfig } from './config';
import { Logger, rootLogger } from './logger';
import { ExplanationStore, ExplanationDocument, ExplanationQuery } from './explanation-store';
import { explainDecision } from './decision-explainer';
import { explainStrategy } from './strategy-explainer';
import { explainPattern } from './pattern-explainer';
import { explainPlayerProfile } from './profile-explainer';
import { explainEpisode } from './episode-explainer';
import { summarizeMatch } from './match-summary';
import { computeBehaviorEvolution } from './behavior-evolution';
import { computeConfidenceEvolution } from './confidence-evolution';
import { compareMatches } from './match-comparison';
import { generatePlayerInsights, PlayerInsightsInputs } from './player-insights';
import { ExplanationNotFoundError } from './errors';
import {
  BehaviorEvolution,
  ConfidenceEvolution,
  ConfidenceHistoryPoint,
  DecisionExplanation,
  EpisodeExplanation,
  ExplanationInputs,
  MatchComparison,
  MatchSummary,
  PatternEntry,
  PatternExplanation,
  PlayerEpisode,
  PlayerInsights,
  PlayerProfileExplanation,
  SemanticDimensionVersion,
  SemanticProfileEntry,
  StrategicIntent,
  StrategyExplanation,
} from './types';

export interface ExplainabilityEngineOptions {
  store: ExplanationStore;
  config?: Partial<ExplainabilityConfig>;
  logger?: Logger;
}

export class ExplainabilityEngine {
  readonly config: ExplainabilityConfig;
  private readonly store: ExplanationStore;
  private readonly logger: Logger;

  constructor(options: ExplainabilityEngineOptions) {
    this.store = options.store;
    this.config = loadExplainabilityConfig(options.config);
    this.logger = (options.logger ?? rootLogger).child({ component: 'explainability-engine' });
  }

  // --- Generation (pure explainer + persist) --------------------------------

  async explainDecision(inputs: ExplanationInputs): Promise<DecisionExplanation> {
    const explanation = explainDecision(inputs, this.config);
    await this.store.store('decision', explanation);
    this.logger.info('Decision explanation generated', { decisionId: explanation.decisionId, matchId: explanation.matchId });
    return explanation;
  }

  async explainStrategy(strategicIntent: StrategicIntent): Promise<StrategyExplanation> {
    const explanation = explainStrategy(strategicIntent, this.config);
    await this.store.store('strategy', explanation);
    return explanation;
  }

  async explainPattern(pattern: PatternEntry, playerId: string, gameId: string, now: number = Date.now()): Promise<PatternExplanation> {
    const explanation = explainPattern(pattern, playerId, gameId, now, this.config);
    await this.store.store('pattern', explanation);
    return explanation;
  }

  async explainPlayerProfile(dimensions: SemanticProfileEntry[], playerId: string, now: number = Date.now()): Promise<PlayerProfileExplanation> {
    const explanation = explainPlayerProfile(dimensions, playerId, now, this.config);
    await this.store.store('playerProfile', explanation);
    return explanation;
  }

  async explainEpisode(episode: PlayerEpisode, now: number = Date.now()): Promise<EpisodeExplanation> {
    const explanation = explainEpisode(episode, now, this.config);
    await this.store.store('episode', explanation);
    return explanation;
  }

  /** Fetches every stored decision explanation for `matchId` and aggregates them. Requires at least one to already be stored via explainDecision(). */
  async summarizeMatch(matchId: string, now: number = Date.now()): Promise<MatchSummary> {
    const docs = await this.store.getForMatch(matchId, 'decision');
    if (docs.length === 0) throw new ExplanationNotFoundError(`no decision explanations stored for match ${matchId}`);
    const explanations = docs.map((d) => d.explanation as DecisionExplanation);
    const summary = summarizeMatch(explanations, matchId, now, this.config);
    await this.store.store('matchSummary', summary);
    return summary;
  }

  async computeBehaviorEvolution(history: SemanticDimensionVersion[], playerId: string, dimension: string, now: number = Date.now()): Promise<BehaviorEvolution> {
    const evolution = computeBehaviorEvolution(history, playerId, dimension, now, this.config);
    await this.store.store('behaviorEvolution', evolution);
    return evolution;
  }

  async computeConfidenceEvolution(history: ConfidenceHistoryPoint[], playerId: string, subjectKind: 'semanticDimension' | 'pattern', subjectId: string, now: number = Date.now()): Promise<ConfidenceEvolution> {
    const evolution = computeConfidenceEvolution(history, playerId, subjectKind, subjectId, now, this.config);
    await this.store.store('confidenceEvolution', evolution);
    return evolution;
  }

  /** Fetches the latest stored MatchSummary for each of `beforeMatchId`/`afterMatchId` (call summarizeMatch() first for each) and diffs them. */
  async compareMatches(beforeMatchId: string, afterMatchId: string, dimensionsBefore: SemanticProfileEntry[], dimensionsAfter: SemanticProfileEntry[], now: number = Date.now()): Promise<MatchComparison> {
    const [beforeDocs, afterDocs] = await Promise.all([this.store.getForMatch(beforeMatchId, 'matchSummary'), this.store.getForMatch(afterMatchId, 'matchSummary')]);
    if (beforeDocs.length === 0) throw new ExplanationNotFoundError(`no MatchSummary stored for match ${beforeMatchId}`);
    if (afterDocs.length === 0) throw new ExplanationNotFoundError(`no MatchSummary stored for match ${afterMatchId}`);
    const before = beforeDocs[beforeDocs.length - 1].explanation as MatchSummary;
    const after = afterDocs[afterDocs.length - 1].explanation as MatchSummary;
    const comparison = compareMatches(before, after, dimensionsBefore, dimensionsAfter, now, this.config);
    await this.store.store('matchComparison', comparison);
    return comparison;
  }

  async generatePlayerInsights(inputs: PlayerInsightsInputs, now: number = Date.now()): Promise<PlayerInsights> {
    const insights = generatePlayerInsights(inputs, now, this.config);
    await this.store.store('playerInsights', insights);
    return insights;
  }

  // --- Read queries -----------------------------------------------------------

  async getById(explanationId: string): Promise<ExplanationDocument | null> {
    return this.store.getById(explanationId);
  }

  async getByDecisionId(decisionId: string): Promise<ExplanationDocument | null> {
    return this.store.getByDecisionId(decisionId);
  }

  async getLatestPatternExplanation(playerId: string, patternId: string): Promise<ExplanationDocument | null> {
    return this.store.getLatestByPatternId(playerId, patternId);
  }

  async getMatchExplanations(matchId: string): Promise<ExplanationDocument[]> {
    return this.store.getForMatch(matchId, 'decision');
  }

  async getTimeline(playerId: string, options: { gameId?: string; fromTs?: number; toTs?: number; limit?: number } = {}): Promise<ExplanationDocument[]> {
    return this.store.getTimeline(playerId, options);
  }

  async getHistory(query: ExplanationQuery): Promise<{ explanations: ExplanationDocument[]; total: number }> {
    return this.store.search(query);
  }

  async getLatestPlayerInsights(playerId: string, gameId?: string): Promise<PlayerInsights | null> {
    const doc = await this.store.getLatestForPlayer(playerId, 'playerInsights', gameId);
    return doc ? (doc.explanation as PlayerInsights) : null;
  }

  async getLatestBehaviorEvolution(playerId: string, gameId: string | undefined): Promise<ExplanationDocument[]> {
    const { explanations } = await this.store.search({ playerId, gameId, explanationType: 'behaviorEvolution' });
    return explanations;
  }
}
