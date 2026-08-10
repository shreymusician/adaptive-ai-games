/**
 * Authorization layer for the Adaptive AI Engine's dashboard API
 * (@adaptive-ai/orchestration's dashboardRouter). That router is
 * deliberately auth-free by design (see its own doc comment) — it expects
 * to be mounted behind whatever session/auth middleware the host app
 * already applies. This is that middleware for platform/api.
 *
 * Reuses the existing `authenticateToken` JWT middleware for identity
 * (no second auth system) and adds one rule on top: the authenticated
 * user (`req.userId`) may only ever read data keyed to their own player
 * id, never a `:playerId` supplied in the URL.
 */
import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';

/**
 * For dashboard routes shaped `/dashboard/players/:playerId/...` — rejects
 * the request unless the URL's playerId matches the verified JWT subject.
 * Must run after `authenticateToken` (relies on `req.userId` already being
 * set); if it isn't, this fails closed rather than open.
 */
export const requireOwnPlayerId = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const { playerId } = req.params;
  if (!req.userId || playerId !== req.userId) {
    res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    return;
  }
  next();
};

/**
 * For `/dashboard/matches/:matchId/report` — this route has no `:playerId`
 * in its URL (a match report is keyed by matchId alone), so ownership can
 * only be checked against the report body itself, after the real handler
 * (mounted downstream in server.ts) fetches it. Wraps `res.json` so that a
 * report belonging to a different player is swapped for the exact same
 * 404 shape the real handler already returns for a genuinely missing
 * match — an authorization failure must not be distinguishable from a
 * not-found, or its response would leak that the match exists at all.
 */
export const filterMatchReportByOwner = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (body && typeof body === 'object' && 'playerId' in body) {
      const reportPlayerId = (body as { playerId?: unknown }).playerId;
      if (reportPlayerId !== req.userId) {
        res.status(404);
        return originalJson({ error: `No processing report for match ${req.params.matchId}`, code: 'NOT_FOUND' });
      }
    }
    return originalJson(body);
  }) as Response['json'];
  next();
};
