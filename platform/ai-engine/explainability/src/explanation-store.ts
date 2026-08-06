/**
 * ExplanationStore — persistence for every explanation this package
 * produces, collection `explanations`. Every explainer function in this
 * package is pure (no I/O) by deliberate convention (see decision-
 * explainer.ts's doc comment) — this is the ONE place that store actually
 * touches a database, exactly mirroring @adaptive-ai/memory-engine's
 * EpisodicMemoryStore/SemanticMemoryStore split between pure computation
 * and persistence.
 *
 * A single collection (rather than one per explanation type) is what makes
 * "Timeline" and "Explanation History" — chronological/paginated views
 * ACROSS explanation types for one player — a single indexed query instead
 * of a fan-out across ten collections.
 */

import { Db, Collection } from 'mongodb';
import { AnyExplanation, ExplanationType, StoredExplanation } from './types';

export interface ExplanationDocument extends StoredExplanation {
  explanationId: string;
  generatedAt: number;
  /** Extracted for direct indexing — only decision-type explanations carry a decisionId; null otherwise. */
  decisionId: string | null;
  /** Extracted for direct indexing — only pattern-type explanations carry a patternId; null otherwise. */
  patternId: string | null;
}

export interface ExplanationQuery {
  playerId?: string;
  matchId?: string;
  gameId?: string;
  explanationType?: ExplanationType;
  fromTs?: number;
  toTs?: number;
  limit?: number;
  offset?: number;
}

function extractMatchId(explanation: AnyExplanation): string | null {
  return 'matchId' in explanation && typeof explanation.matchId === 'string' ? explanation.matchId : null;
}

function extractGameId(explanation: AnyExplanation): string | null {
  if ('gameId' in explanation && (typeof explanation.gameId === 'string' || explanation.gameId === null)) return explanation.gameId;
  return null;
}

function extractDecisionId(explanation: AnyExplanation): string | null {
  return 'decisionId' in explanation && typeof explanation.decisionId === 'string' ? explanation.decisionId : null;
}

function extractPatternId(explanation: AnyExplanation): string | null {
  return 'patternId' in explanation && typeof explanation.patternId === 'string' ? explanation.patternId : null;
}

export class ExplanationStore {
  private readonly explanations: Collection<ExplanationDocument>;

  constructor(db: Db) {
    this.explanations = db.collection<ExplanationDocument>('explanations');
  }

  async ensureIndexes(): Promise<void> {
    await this.explanations.createIndex({ explanationId: 1 }, { unique: true });
    await this.explanations.createIndex({ playerId: 1, generatedAt: -1 }); // Timeline / Explanation History
    await this.explanations.createIndex({ matchId: 1, explanationType: 1 }); // Match Explanation
    await this.explanations.createIndex({ playerId: 1, explanationType: 1, generatedAt: -1 });
    await this.explanations.createIndex({ decisionId: 1 });
    await this.explanations.createIndex({ playerId: 1, patternId: 1 });
  }

  /**
   * Persists (or, for the deterministic-id aggregate types like MatchSummary
   * — see match-summary.ts's doc comment — idempotently REPLACES the prior
   * snapshot of) one explanation. Never mutates the explanation object
   * itself; storage is purely additive bookkeeping on top of an
   * already-fully-computed, already-immutable structured explanation.
   */
  async store(explanationType: ExplanationType, explanation: AnyExplanation, now: number = Date.now()): Promise<ExplanationDocument> {
    const doc: ExplanationDocument = {
      explanationId: explanation.explanationId,
      explanationType,
      playerId: explanation.playerId,
      matchId: extractMatchId(explanation),
      gameId: extractGameId(explanation),
      decisionId: extractDecisionId(explanation),
      patternId: extractPatternId(explanation),
      generatedAt: explanation.generatedAt,
      storedAt: now,
      explanation,
    };
    await this.explanations.replaceOne({ explanationId: doc.explanationId }, doc, { upsert: true });
    return doc;
  }

  async getById(explanationId: string): Promise<ExplanationDocument | null> {
    return this.explanations.findOne({ explanationId });
  }

  async getByDecisionId(decisionId: string): Promise<ExplanationDocument | null> {
    return this.explanations.findOne({ decisionId, explanationType: 'decision' });
  }

  /** Most recent stored pattern explanation for one (playerId, patternId), or null. */
  async getLatestByPatternId(playerId: string, patternId: string): Promise<ExplanationDocument | null> {
    const docs = await this.explanations.find({ playerId, patternId, explanationType: 'pattern' }).sort({ generatedAt: -1 }).limit(1).toArray();
    return docs[0] ?? null;
  }

  async getForMatch(matchId: string, explanationType?: ExplanationType): Promise<ExplanationDocument[]> {
    const filter: Record<string, unknown> = { matchId };
    if (explanationType) filter.explanationType = explanationType;
    return this.explanations.find(filter).sort({ generatedAt: 1 }).toArray();
  }

  /** Chronological, cross-type feed for one player — backs the Timeline API. */
  async getTimeline(playerId: string, options: { gameId?: string; fromTs?: number; toTs?: number; limit?: number } = {}): Promise<ExplanationDocument[]> {
    const filter: Record<string, unknown> = { playerId };
    if (options.gameId !== undefined) filter.gameId = options.gameId;
    if (options.fromTs !== undefined || options.toTs !== undefined) {
      filter.generatedAt = {};
      if (options.fromTs !== undefined) (filter.generatedAt as Record<string, number>).$gte = options.fromTs;
      if (options.toTs !== undefined) (filter.generatedAt as Record<string, number>).$lte = options.toTs;
    }
    return this.explanations.find(filter).sort({ generatedAt: -1 }).limit(options.limit ?? 50).toArray();
  }

  /** Paginated, filterable feed — backs the Explanation History API. */
  async search(query: ExplanationQuery): Promise<{ explanations: ExplanationDocument[]; total: number }> {
    const filter: Record<string, unknown> = {};
    if (query.playerId !== undefined) filter.playerId = query.playerId;
    if (query.matchId !== undefined) filter.matchId = query.matchId;
    if (query.gameId !== undefined) filter.gameId = query.gameId;
    if (query.explanationType !== undefined) filter.explanationType = query.explanationType;
    if (query.fromTs !== undefined || query.toTs !== undefined) {
      filter.generatedAt = {};
      if (query.fromTs !== undefined) (filter.generatedAt as Record<string, number>).$gte = query.fromTs;
      if (query.toTs !== undefined) (filter.generatedAt as Record<string, number>).$lte = query.toTs;
    }
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const [explanations, total] = await Promise.all([
      this.explanations.find(filter).sort({ generatedAt: -1 }).skip(offset).limit(limit).toArray(),
      this.explanations.countDocuments(filter),
    ]);
    return { explanations, total };
  }

  /** Latest stored explanation of a given type for a player (e.g. the current PlayerInsights snapshot). */
  async getLatestForPlayer(playerId: string, explanationType: ExplanationType, gameId?: string): Promise<ExplanationDocument | null> {
    const filter: Record<string, unknown> = { playerId, explanationType };
    if (gameId !== undefined) filter.gameId = gameId;
    const [doc] = await this.explanations.find(filter).sort({ generatedAt: -1 }).limit(1).toArray();
    return doc ?? null;
  }
}
