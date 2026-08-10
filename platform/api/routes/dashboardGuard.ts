/**
 * Authorization gate for @adaptive-ai/orchestration's dashboardRouter.
 * Mounted at `/api` in server.ts BEFORE `aiStack.dashboardRouter`, matching
 * every one of that router's own path patterns exactly. Each route here
 * only ever calls `next()` on success — it never handles the request
 * itself — so a passing request falls through Express's middleware stack
 * into the real handler registered later by `aiStack.dashboardRouter`.
 * A failing request is rejected here and never reaches AI Engine code.
 *
 * Does not modify @adaptive-ai/orchestration in any way — that package
 * stays exactly as built, and explicitly documents this as its intended
 * extension point ("mounted behind whatever session/auth middleware the
 * host application already applies").
 */
import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { requireOwnPlayerId, filterMatchReportByOwner } from '../middleware/dashboardAuth';

const router = Router();

router.get('/dashboard/players/:playerId/profile', authenticateToken, requireOwnPlayerId);
router.get('/dashboard/players/:playerId/dimensions', authenticateToken, requireOwnPlayerId);
router.get('/dashboard/players/:playerId/dimensions/:dimension/history', authenticateToken, requireOwnPlayerId);
router.get('/dashboard/players/:playerId/patterns', authenticateToken, requireOwnPlayerId);
router.get('/dashboard/players/:playerId/patterns/:patternId/history', authenticateToken, requireOwnPlayerId);
router.get('/dashboard/players/:playerId/episodes', authenticateToken, requireOwnPlayerId);
router.get('/dashboard/players/:playerId/reports', authenticateToken, requireOwnPlayerId);
router.get('/dashboard/matches/:matchId/report', authenticateToken, filterMatchReportByOwner);

export default router;
