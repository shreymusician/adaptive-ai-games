/**
 * Match lifecycle bridge between platform/api's long-lived player-session
 * JWT (authenticateToken, `req.userId`) and the Event Pipeline's short-lived,
 * match-scoped ingestion token (@adaptive-ai/event-pipeline's
 * mintMatchToken — see its own auth.ts doc comment for why these are
 * deliberately separate token types).
 *
 * A signed-in player calls POST /api/match/start once per match, and gets
 * back a matchId + matchToken to hand to the SDK Host, which then submits
 * gameplay events straight to POST /api/events/batch (mounted separately,
 * from @adaptive-ai/orchestration's OrchestrationStack.eventRouter) — this
 * route never touches event ingestion itself.
 */

import { Router, Response } from 'express';
import { randomUUID } from 'crypto';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { getAIStack } from '../ai/bootstrap';

const router = Router();
router.use(authenticateToken);

interface StartMatchBody {
  gameId: string;
}

router.post('/match/start', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { gameId } = req.body as StartMatchBody;
    if (!gameId || typeof gameId !== 'string') {
      res.status(400).json({ error: 'gameId is required' });
      return;
    }

    const playerId = req.userId!;
    const matchId = randomUUID();
    const stack = getAIStack();

    const matchToken = stack.mintMatchToken({ matchId, playerId, gameId, scope: 'ingest' });

    res.json({ matchId, playerId, gameId, matchToken });
  } catch (error) {
    console.error('Match start error:', error);
    res.status(500).json({ error: 'Failed to start match' });
  }
});

export default router;
