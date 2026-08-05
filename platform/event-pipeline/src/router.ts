import { Router, Response, NextFunction, json } from 'express';
import { EventStore } from './event-store';
import { EventBatchProcessor } from './event-processor';
import { EventPipelineConfig } from './config';
import { Logger } from './logger';
import { MetricsRegistry } from './metrics';
import { RateLimiter, rateLimit } from './rate-limiter';
import { AuthenticatedRequest, requireMatchToken, assertMatchAccess, assertPlayerAccess, assertGameAccess } from './auth';
import { getHealthReport } from './health';
import { isPipelineError, PayloadTooLargeError, ValidationFailedError } from './errors';

export interface RouterDeps {
  store: EventStore;
  /** Accepts the concrete EventProcessor or any structurally-compatible coordinating wrapper — see EventBatchProcessor's doc comment. */
  processor: EventBatchProcessor;
  config: EventPipelineConfig;
  logger: Logger;
  metrics: MetricsRegistry;
}

function parsePagination(req: AuthenticatedRequest, config: EventPipelineConfig): { limit: number; offset: number } {
  const rawLimit = Number.parseInt(String(req.query.limit ?? ''), 10);
  const rawOffset = Number.parseInt(String(req.query.offset ?? ''), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, config.maxPageSize) : config.defaultPageSize;
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  return { limit, offset };
}

function timingMiddleware(metrics: MetricsRegistry, routeLabel: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const start = Date.now();
    res.on('finish', () => {
      metrics.httpRequestMs.observe(Date.now() - start, { route: routeLabel, method: req.method, status: String(res.statusCode) });
    });
    next();
  };
}

/**
 * Builds the Express Router for every Event Pipeline HTTP endpoint. Kept as
 * a pure function of its dependencies (store/processor/config/logger/
 * metrics) rather than reaching for module-level singletons, so tests can
 * spin up an isolated router against an in-memory Mongo instance and real
 * assertions about auth/rate-limiting/validation without any global state
 * leaking between test cases.
 */
export function createEventPipelineRouter(deps: RouterDeps): Router {
  const { store, processor, config, logger, metrics } = deps;
  const router = Router();

  const batchLimiter = new RateLimiter(config.rateLimitBatchWindowMs, config.rateLimitBatchPerWindow);
  const readLimiter = new RateLimiter(config.rateLimitReadWindowMs, config.rateLimitReadPerWindow);

  const jsonParser = json({ limit: config.maxBatchPayloadBytes });

  // Wrap body-parser so an oversized payload becomes our typed error, not
  // Express's default plaintext 413.
  function guardedJson(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    jsonParser(req, res, (err?: unknown) => {
      if (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.toLowerCase().includes('entity too large')) {
          const e = new PayloadTooLargeError(`Batch payload exceeds ${config.maxBatchPayloadBytes} bytes`);
          res.status(e.status).json(e.toResponseBody());
          return;
        }
        const e = new ValidationFailedError('Malformed JSON body', [message]);
        res.status(e.status).json(e.toResponseBody());
        return;
      }
      next();
    });
  }

  // ---------------------------------------------------------------------
  // POST /api/events/batch
  // ---------------------------------------------------------------------
  router.post(
    '/events/batch',
    timingMiddleware(metrics, 'POST /events/batch'),
    requireMatchToken(config, logger, metrics, 'ingest'),
    guardedJson,
    rateLimit(batchLimiter, (req) => `batch:${req.matchToken!.matchId}`, metrics, logger, 'batch'),
    async (req: AuthenticatedRequest, res: Response) => {
      const claims = req.matchToken!;
      try {
        // matchId/playerId/gameId are taken from the verified token, never
        // from the request body — a plugin cannot submit events under a
        // different match's identity even if it forges the body.
        const result = await processor.processBatch(req.body, claims.matchId, claims.playerId, claims.gameId, '1');

        const httpStatus = result.accepted > 0 ? 202 : 400;
        res.status(httpStatus).json(result);
      } catch (err) {
        handleError(err, res, logger, 'POST /events/batch');
      }
    }
  );

  // ---------------------------------------------------------------------
  // GET /api/events/match/:matchId
  // ---------------------------------------------------------------------
  router.get(
    '/events/match/:matchId',
    timingMiddleware(metrics, 'GET /events/match/:matchId'),
    requireMatchToken(config, logger, metrics, 'replay'),
    rateLimit(readLimiter, (req) => `read:${req.matchToken!.playerId}`, metrics, logger, 'read'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        assertMatchAccess(req.matchToken!, req.params.matchId);
        const { limit, offset } = parsePagination(req, config);
        const { events, total } = await store.getMatchEvents(req.params.matchId, limit, offset);
        res.json({ matchId: req.params.matchId, eventCount: events.length, events, pagination: { limit, offset, total } });
      } catch (err) {
        handleError(err, res, logger, 'GET /events/match/:matchId');
      }
    }
  );

  // ---------------------------------------------------------------------
  // GET /api/events/player/:playerId
  // ---------------------------------------------------------------------
  router.get(
    '/events/player/:playerId',
    timingMiddleware(metrics, 'GET /events/player/:playerId'),
    requireMatchToken(config, logger, metrics, 'replay'),
    rateLimit(readLimiter, (req) => `read:${req.matchToken!.playerId}`, metrics, logger, 'read'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        assertPlayerAccess(req.matchToken!, req.params.playerId);
        const { limit, offset } = parsePagination(req, config);
        const { events, total } = await store.getPlayerEvents(req.params.playerId, limit, offset);
        res.json({ playerId: req.params.playerId, eventCount: events.length, events, pagination: { limit, offset, total } });
      } catch (err) {
        handleError(err, res, logger, 'GET /events/player/:playerId');
      }
    }
  );

  // ---------------------------------------------------------------------
  // GET /api/events/game/:gameId
  // ---------------------------------------------------------------------
  router.get(
    '/events/game/:gameId',
    timingMiddleware(metrics, 'GET /events/game/:gameId'),
    requireMatchToken(config, logger, metrics, 'admin'),
    rateLimit(readLimiter, (req) => `read:${req.matchToken!.playerId}`, metrics, logger, 'read'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        assertGameAccess(req.matchToken!);
        const { limit, offset } = parsePagination(req, config);
        const { events, total } = await store.getGameEvents(req.params.gameId, limit, offset);
        res.json({ gameId: req.params.gameId, eventCount: events.length, events, pagination: { limit, offset, total } });
      } catch (err) {
        handleError(err, res, logger, 'GET /events/game/:gameId');
      }
    }
  );

  // ---------------------------------------------------------------------
  // GET /api/events/replay
  // ---------------------------------------------------------------------
  router.get(
    '/events/replay',
    timingMiddleware(metrics, 'GET /events/replay'),
    requireMatchToken(config, logger, metrics, 'replay'),
    rateLimit(readLimiter, (req) => `read:${req.matchToken!.playerId}`, metrics, logger, 'read'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const claims = req.matchToken!;
        const matchId = typeof req.query.matchId === 'string' ? req.query.matchId : undefined;
        const playerId = typeof req.query.playerId === 'string' ? req.query.playerId : undefined;
        const gameId = typeof req.query.gameId === 'string' ? req.query.gameId : undefined;

        if (!matchId && !playerId && !gameId) {
          throw new ValidationFailedError('At least one of matchId, playerId, gameId is required', [
            'Provide matchId, playerId, and/or gameId as query parameters',
          ]);
        }

        if (matchId) assertMatchAccess(claims, matchId);
        if (playerId) assertPlayerAccess(claims, playerId);
        if (gameId && !matchId && !playerId) assertGameAccess(claims);

        const fromSeq = req.query.fromSeq !== undefined ? Number.parseInt(String(req.query.fromSeq), 10) : undefined;
        const toSeq = req.query.toSeq !== undefined ? Number.parseInt(String(req.query.toSeq), 10) : undefined;
        const fromTs = req.query.fromTs !== undefined ? Number.parseInt(String(req.query.fromTs), 10) : undefined;
        const toTs = req.query.toTs !== undefined ? Number.parseInt(String(req.query.toTs), 10) : undefined;

        const { limit, offset } = parsePagination(req, config);

        const replayStart = Date.now();
        const { events, total } = await store.queryEvents({ matchId, playerId, gameId, fromSeq, toSeq, fromTs, toTs }, limit, offset);
        metrics.replayLatencyMs.observe(Date.now() - replayStart);

        res.json({
          filter: { matchId, playerId, gameId, fromSeq, toSeq, fromTs, toTs },
          eventCount: events.length,
          events,
          pagination: { limit, offset, total },
        });
      } catch (err) {
        handleError(err, res, logger, 'GET /events/replay');
      }
    }
  );

  // ---------------------------------------------------------------------
  // GET /api/events/health — unauthenticated (load balancer / uptime probe)
  // ---------------------------------------------------------------------
  router.get('/events/health', timingMiddleware(metrics, 'GET /events/health'), async (_req, res: Response) => {
    const report = await getHealthReport(store, metrics, config);
    const httpStatus = report.status === 'unhealthy' ? 503 : 200;
    res.status(httpStatus).json(report);
  });

  // ---------------------------------------------------------------------
  // GET /api/events/metrics — Prometheus text exposition format
  // ---------------------------------------------------------------------
  router.get('/events/metrics', timingMiddleware(metrics, 'GET /events/metrics'), (_req, res: Response) => {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(metrics.toPrometheusText());
  });

  return router;
}

function handleError(err: unknown, res: Response, logger: Logger, route: string): void {
  if (isPipelineError(err)) {
    if (err.status >= 500) {
      logger.error('Pipeline error', { route, error: err.message, code: err.code });
    }
    res.status(err.status).json(err.toResponseBody());
    return;
  }
  logger.error('Unhandled error in route', { route, error: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
}
