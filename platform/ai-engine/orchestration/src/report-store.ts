/**
 * ReportStore — durable persistence for `MatchProcessingReport`, the
 * orchestration layer's own output. Structurally the same
 * dependency-injected `Db`-collection shape every other AI-engine store in
 * this monorepo uses (Memory Engine's stores, Pattern Recognition's
 * PatternStore).
 *
 * This is deliberately a NEW collection (`matchProcessingReports`), not a
 * field bolted onto `matchMemories` — Memory Engine's schema is owned by
 * Memory Engine (see its README's "Persistence boundary" precedent, which
 * Pattern Recognition's own PatternStore already follows for the same
 * reason). The orchestrator's run history is its own concern.
 */

import { Collection, Db } from 'mongodb';
import { MatchProcessingReport } from './types';

export class ReportStore {
  private readonly reports: Collection<MatchProcessingReport>;

  constructor(db: Db) {
    this.reports = db.collection<MatchProcessingReport>('matchProcessingReports');
  }

  async ensureIndexes(): Promise<void> {
    await this.reports.createIndex({ matchId: 1 }, { unique: true });
    await this.reports.createIndex({ playerId: 1, completedAt: -1 });
    await this.reports.createIndex({ gameId: 1, completedAt: -1 });
    await this.reports.createIndex({ status: 1, completedAt: -1 });
  }

  /**
   * Upsert on matchId — a match is processed exactly once in the normal
   * flow, but this stays idempotent (rather than throwing E11000) so a
   * caller that deliberately re-runs analysis for an already-committed
   * match (see MatchOrchestrator's completeMatch() doc comment) can save
   * an updated report without a special-case delete-then-insert.
   */
  async save(report: MatchProcessingReport): Promise<void> {
    await this.reports.updateOne({ matchId: report.matchId }, { $set: report }, { upsert: true });
  }

  async getByMatchId(matchId: string): Promise<MatchProcessingReport | null> {
    return this.reports.findOne({ matchId });
  }

  async getRecentForPlayer(playerId: string, limit: number = 20): Promise<MatchProcessingReport[]> {
    return this.reports.find({ playerId }).sort({ completedAt: -1 }).limit(limit).toArray();
  }

  async getRecentForGame(gameId: string, limit: number = 20): Promise<MatchProcessingReport[]> {
    return this.reports.find({ gameId }).sort({ completedAt: -1 }).limit(limit).toArray();
  }

  /** Ops/debugging: most recent reports across all players, optionally filtered by status. */
  async getRecent(limit: number = 50, status?: MatchProcessingReport['status']): Promise<MatchProcessingReport[]> {
    const filter = status ? { status } : {};
    return this.reports.find(filter).sort({ completedAt: -1 }).limit(limit).toArray();
  }
}
