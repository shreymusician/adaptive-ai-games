import { Router, Response } from 'express';
import GameMemory, { GameType } from '../models/GameMemory';
import GameSession from '../models/GameSession';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticateToken);

interface MemoryBody {
  data: Record<string, any>;
}

interface MatchBody {
  gameType: GameType;
  won: boolean;
  duration: number;
}

router.get('/memory/:gameType', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { gameType } = req.params;

    const memory = await GameMemory.findOne({
      playerId: req.userId,
      gameType: gameType as GameType,
    });

    if (!memory) {
      res.json({ data: {} });
      return;
    }

    res.json({ data: memory.data });
  } catch (error) {
    console.error('Memory fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch memory' });
  }
});

router.post('/memory/:gameType', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { gameType } = req.params;
    const { data } = req.body as MemoryBody;

    if (!data) {
      res.status(400).json({ error: 'data is required' });
      return;
    }

    let memory = await GameMemory.findOne({
      playerId: req.userId,
      gameType: gameType as GameType,
    });

    if (!memory) {
      memory = new GameMemory({
        playerId: req.userId,
        gameType: gameType as GameType,
        data,
      });
    } else {
      memory.data = data;
    }

    await memory.save();

    res.json({
      success: true,
      data: memory.data,
    });
  } catch (error) {
    console.error('Memory save error:', error);
    res.status(500).json({ error: 'Failed to save memory' });
  }
});

router.post('/match', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { gameType, won, duration } = req.body as MatchBody;

    if (!gameType || typeof won !== 'boolean' || !duration) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const lastSession = await GameSession.findOne({
      playerId: req.userId,
      gameType,
    }).sort({ matchNumber: -1 });

    const matchNumber = (lastSession?.matchNumber || 0) + 1;

    const session = new GameSession({
      playerId: req.userId,
      gameType,
      matchNumber,
      won,
      duration,
      timestamp: new Date(),
    });

    await session.save();

    res.json({
      success: true,
      matchNumber,
    });
  } catch (error) {
    console.error('Match log error:', error);
    res.status(500).json({ error: 'Failed to log match' });
  }
});

router.get('/stats/:gameType', async (req: AuthRequest, res: Response) => {
  try {
    const { gameType } = req.params;

    const sessions = await GameSession.find({
      playerId: req.userId,
      gameType: gameType as GameType,
    });

    const wins = sessions.filter((s) => s.won).length;
    const total = sessions.length;
    const winRate = total > 0 ? (wins / total) * 100 : 0;

    res.json({
      gameType,
      totalMatches: total,
      wins,
      losses: total - wins,
      winRate: winRate.toFixed(2),
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

export default router;
