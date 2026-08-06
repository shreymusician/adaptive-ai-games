/**
 * Explainability read-API — thin pass-through to ExplainabilityEngine's
 * already-tested public methods, no new business logic. Same convention as
 * @adaptive-ai/orchestration's dashboard-router.ts: mounted behind whatever
 * session/auth middleware the host application already applies; not
 * authenticated here.
 */

import { Router, Request, Response } from 'express';
import { ExplainabilityEngine } from './explainability-engine';
import { Logger } from './logger';
import { isExplainabilityError } from './errors';
import { ExplanationType } from './types';

export interface ExplainabilityRouterDeps {
  engine: ExplainabilityEngine;
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

export function createExplainabilityRouter(deps: ExplainabilityRouterDeps): Router {
  const { engine, logger } = deps;
  const router = Router();

  function handle(route: string, fn: (req: Request, res: Response) => Promise<void>) {
    return async (req: Request, res: Response): Promise<void> => {
      try {
        await fn(req, res);
      } catch (err) {
        if (isExplainabilityError(err)) {
          res.status(err.code === 'EXPLANATION_NOT_FOUND' ? 404 : 400).json({ error: err.message, code: err.code });
          return;
        }
        logger.error('Explainability route error', { route, error: err instanceof Error ? err.message : String(err) });
        res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
      }
    };
  }

  // -----------------------------------------------------------------
  // GET /explainability/decisions/:decisionId
  // -----------------------------------------------------------------
  router.get(
    '/explainability/decisions/:decisionId',
    handle('GET /explainability/decisions/:decisionId', async (req, res) => {
      const doc = await engine.getByDecisionId(req.params.decisionId);
      if (!doc) {
        res.status(404).json({ error: `No stored explanation for decision ${req.params.decisionId}`, code: 'NOT_FOUND' });
        return;
      }
      res.json(doc.explanation);
    })
  );

  // -----------------------------------------------------------------
  // GET /explainability/matches/:matchId
  // Every decision explanation recorded for this match, chronological.
  // -----------------------------------------------------------------
  router.get(
    '/explainability/matches/:matchId',
    handle('GET /explainability/matches/:matchId', async (req, res) => {
      const docs = await engine.getMatchExplanations(req.params.matchId);
      res.json({ matchId: req.params.matchId, decisionCount: docs.length, decisions: docs.map((d) => d.explanation) });
    })
  );

  // -----------------------------------------------------------------
  // GET /explainability/matches/:matchId/summary
  // Computes (and persists) the MatchSummary from every stored decision
  // explanation for this match.
  // -----------------------------------------------------------------
  router.get(
    '/explainability/matches/:matchId/summary',
    handle('GET /explainability/matches/:matchId/summary', async (req, res) => {
      const summary = await engine.summarizeMatch(req.params.matchId);
      res.json(summary);
    })
  );

  // -----------------------------------------------------------------
  // GET /explainability/players/:playerId/summary?gameId=
  // Latest stored PlayerInsights snapshot.
  // -----------------------------------------------------------------
  router.get(
    '/explainability/players/:playerId/summary',
    handle('GET /explainability/players/:playerId/summary', async (req, res) => {
      const insights = await engine.getLatestPlayerInsights(req.params.playerId, queryString(req, 'gameId'));
      if (!insights) {
        res.status(404).json({ error: `No PlayerInsights stored for player ${req.params.playerId}`, code: 'NOT_FOUND' });
        return;
      }
      res.json(insights);
    })
  );

  // -----------------------------------------------------------------
  // GET /explainability/players/:playerId/patterns/:patternId
  // -----------------------------------------------------------------
  router.get(
    '/explainability/players/:playerId/patterns/:patternId',
    handle('GET /explainability/players/:playerId/patterns/:patternId', async (req, res) => {
      const doc = await engine.getLatestPatternExplanation(req.params.playerId, req.params.patternId);
      if (!doc) {
        res.status(404).json({ error: `No stored explanation for pattern ${req.params.patternId}`, code: 'NOT_FOUND' });
        return;
      }
      res.json(doc.explanation);
    })
  );

  // -----------------------------------------------------------------
  // GET /explainability/players/:playerId/timeline?gameId=&fromTs=&toTs=&limit=
  // -----------------------------------------------------------------
  router.get(
    '/explainability/players/:playerId/timeline',
    handle('GET /explainability/players/:playerId/timeline', async (req, res) => {
      const docs = await engine.getTimeline(req.params.playerId, {
        gameId: queryString(req, 'gameId'),
        fromTs: req.query.fromTs !== undefined ? queryInt(req, 'fromTs', 0) : undefined,
        toTs: req.query.toTs !== undefined ? queryInt(req, 'toTs', 0) : undefined,
        limit: queryInt(req, 'limit', 50),
      });
      res.json({ playerId: req.params.playerId, count: docs.length, entries: docs.map((d) => ({ explanationType: d.explanationType, generatedAt: d.generatedAt, explanation: d.explanation })) });
    })
  );

  // -----------------------------------------------------------------
  // GET /explainability/players/:playerId/profile-evolution?gameId=
  // Every stored BehaviorEvolution snapshot for this player.
  // -----------------------------------------------------------------
  router.get(
    '/explainability/players/:playerId/profile-evolution',
    handle('GET /explainability/players/:playerId/profile-evolution', async (req, res) => {
      const docs = await engine.getLatestBehaviorEvolution(req.params.playerId, queryString(req, 'gameId'));
      res.json({ playerId: req.params.playerId, count: docs.length, evolutions: docs.map((d) => d.explanation) });
    })
  );

  // -----------------------------------------------------------------
  // GET /explainability/players/:playerId/history?matchId=&gameId=&explanationType=&limit=&offset=
  // -----------------------------------------------------------------
  router.get(
    '/explainability/players/:playerId/history',
    handle('GET /explainability/players/:playerId/history', async (req, res) => {
      const { explanations, total } = await engine.getHistory({
        playerId: req.params.playerId,
        matchId: queryString(req, 'matchId'),
        gameId: queryString(req, 'gameId'),
        explanationType: queryString(req, 'explanationType') as ExplanationType | undefined,
        limit: queryInt(req, 'limit', 50),
        offset: queryInt(req, 'offset', 0),
      });
      res.json({ playerId: req.params.playerId, count: explanations.length, total, entries: explanations });
    })
  );

  return router;
}
