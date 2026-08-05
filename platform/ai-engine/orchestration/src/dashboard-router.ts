/**
 * Dashboard read-API — proves the AI pipeline actually works by exposing
 * everything MatchOrchestrator has produced: player profile, behavioral
 * dimensions, detected patterns, recent episodes, confidence/version
 * history, and per-match processing reports.
 *
 * Deliberately read-only and unopinionated about presentation — per the
 * mandate, "it does not need to be beautiful, it needs to prove the AI
 * works." Every endpoint is a thin pass-through to the already-tested
 * public API of Memory Engine / Pattern Recognition / this package's own
 * ReportStore; no new business logic is introduced here.
 *
 * Auth is intentionally NOT baked in here — this router is mounted behind
 * whatever session/auth middleware the host application (platform/api)
 * already applies, exactly like platform/api's other authenticated routes.
 * See this package's README "Known limitations" for the current gap (no
 * per-route authorization check that the requesting user IS `playerId`).
 */

import { Router, Request, Response } from 'express';
import { MemoryEngine } from '@adaptive-ai/memory-engine';
import { PatternStore, PatternCategory, PatternLifecycleState } from '@adaptive-ai/pattern-recognition';
import { ReportStore } from './report-store';
import { Logger } from './logger';

export interface DashboardRouterDeps {
  memoryEngine: MemoryEngine;
  patternStore: PatternStore;
  reportStore: ReportStore;
  logger: Logger;
}

function queryString(req: Request, key: string): string | undefined {
  const v = req.query[key];
  return typeof v === 'string' ? v : undefined;
}

function queryInt(req: Request, key: string, fallback: number): number {
  const raw = req.query[key];
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function queryFloat(req: Request, key: string): number | undefined {
  const raw = req.query[key];
  const parsed = typeof raw === 'string' ? Number.parseFloat(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function createDashboardRouter(deps: DashboardRouterDeps): Router {
  const { memoryEngine, patternStore, reportStore, logger } = deps;
  const router = Router();

  function handle(route: string, fn: (req: Request, res: Response) => Promise<void>) {
    return async (req: Request, res: Response): Promise<void> => {
      try {
        await fn(req, res);
      } catch (err) {
        logger.error('Dashboard route error', { route, error: err instanceof Error ? err.message : String(err) });
        res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
      }
    };
  }

  // -----------------------------------------------------------------
  // GET /dashboard/players/:playerId/profile?gameId=
  // The single "everything we know about this player" aggregate view.
  // -----------------------------------------------------------------
  router.get(
    '/dashboard/players/:playerId/profile',
    handle('GET /dashboard/players/:playerId/profile', async (req, res) => {
      const gameId = queryString(req, 'gameId');
      const snapshot = await memoryEngine.loadPlayerMemory(req.params.playerId, gameId, {
        recentMatchLimit: queryInt(req, 'recentMatchLimit', 5),
        topEpisodesLimit: queryInt(req, 'topEpisodesLimit', 10),
      });
      res.json(snapshot);
    })
  );

  // -----------------------------------------------------------------
  // GET /dashboard/players/:playerId/dimensions?gameId=
  // Current behavioral dimensions (Player Modeling's output).
  // -----------------------------------------------------------------
  router.get(
    '/dashboard/players/:playerId/dimensions',
    handle('GET /dashboard/players/:playerId/dimensions', async (req, res) => {
      const gameId = queryString(req, 'gameId');
      const dimensions = await memoryEngine.getSemanticProfile(req.params.playerId, gameId);
      res.json({ playerId: req.params.playerId, gameId: gameId ?? null, dimensions });
    })
  );

  // -----------------------------------------------------------------
  // GET /dashboard/players/:playerId/dimensions/:dimension/history?gameId=&limit=
  // Confidence/value history for one dimension — the audit trail.
  // -----------------------------------------------------------------
  router.get(
    '/dashboard/players/:playerId/dimensions/:dimension/history',
    handle('GET /dashboard/players/:playerId/dimensions/:dimension/history', async (req, res) => {
      const gameId = queryString(req, 'gameId') ?? null;
      const history = await memoryEngine.getSemanticHistory(req.params.playerId, gameId, req.params.dimension, queryInt(req, 'limit', 50));
      res.json({ playerId: req.params.playerId, gameId, dimension: req.params.dimension, history });
    })
  );

  // -----------------------------------------------------------------
  // GET /dashboard/players/:playerId/patterns?gameId=&category=&state=&minConfidence=
  // Detected behavioral patterns (Pattern Recognition's output).
  // -----------------------------------------------------------------
  router.get(
    '/dashboard/players/:playerId/patterns',
    handle('GET /dashboard/players/:playerId/patterns', async (req, res) => {
      const gameId = queryString(req, 'gameId');
      if (!gameId) {
        res.status(400).json({ error: 'gameId query parameter is required', code: 'VALIDATION_FAILED' });
        return;
      }
      const category = queryString(req, 'category') as PatternCategory | undefined;
      const state = queryString(req, 'state') as PatternLifecycleState | undefined;
      const { patterns, total } = await patternStore.search({
        playerId: req.params.playerId,
        gameId,
        category,
        state,
        minConfidence: queryFloat(req, 'minConfidence'),
        sortBy: queryString(req, 'sortBy') === 'recent' ? 'recent' : 'confidence',
        limit: queryInt(req, 'limit', 50),
        offset: queryInt(req, 'offset', 0),
      });
      res.json({ playerId: req.params.playerId, gameId, patternCount: patterns.length, total, patterns });
    })
  );

  // -----------------------------------------------------------------
  // GET /dashboard/players/:playerId/patterns/:patternId/history?gameId=
  // -----------------------------------------------------------------
  router.get(
    '/dashboard/players/:playerId/patterns/:patternId/history',
    handle('GET /dashboard/players/:playerId/patterns/:patternId/history', async (req, res) => {
      const gameId = queryString(req, 'gameId');
      if (!gameId) {
        res.status(400).json({ error: 'gameId query parameter is required', code: 'VALIDATION_FAILED' });
        return;
      }
      const history = await patternStore.getHistory(req.params.playerId, gameId, req.params.patternId, queryInt(req, 'limit', 100));
      res.json({ playerId: req.params.playerId, gameId, patternId: req.params.patternId, history });
    })
  );

  // -----------------------------------------------------------------
  // GET /dashboard/players/:playerId/episodes?gameId=&sortBy=
  // Recent/notable episodic memories.
  // -----------------------------------------------------------------
  router.get(
    '/dashboard/players/:playerId/episodes',
    handle('GET /dashboard/players/:playerId/episodes', async (req, res) => {
      const { episodes, total } = await memoryEngine.searchEpisodes({
        playerId: req.params.playerId,
        gameId: queryString(req, 'gameId'),
        sortBy: queryString(req, 'sortBy') === 'recent' ? 'recent' : 'importance',
        limit: queryInt(req, 'limit', 20),
        offset: queryInt(req, 'offset', 0),
      });
      res.json({ playerId: req.params.playerId, episodeCount: episodes.length, total, episodes });
    })
  );

  // -----------------------------------------------------------------
  // GET /dashboard/matches/:matchId/report
  // The MatchProcessingReport for one MatchEnded run — the direct proof
  // that the orchestration workflow executed for this match.
  // -----------------------------------------------------------------
  router.get(
    '/dashboard/matches/:matchId/report',
    handle('GET /dashboard/matches/:matchId/report', async (req, res) => {
      const report = await reportStore.getByMatchId(req.params.matchId);
      if (!report) {
        res.status(404).json({ error: `No processing report for match ${req.params.matchId}`, code: 'NOT_FOUND' });
        return;
      }
      res.json(report);
    })
  );

  // -----------------------------------------------------------------
  // GET /dashboard/players/:playerId/reports?limit=
  // Recent match-processing history for a player.
  // -----------------------------------------------------------------
  router.get(
    '/dashboard/players/:playerId/reports',
    handle('GET /dashboard/players/:playerId/reports', async (req, res) => {
      const reports = await reportStore.getRecentForPlayer(req.params.playerId, queryInt(req, 'limit', 20));
      res.json({ playerId: req.params.playerId, reportCount: reports.length, reports });
    })
  );

  return router;
}
