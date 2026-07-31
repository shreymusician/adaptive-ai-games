import { Router, Request, Response } from 'express';
import GameMemory, { GameType } from '../models/GameMemory';
import GameSession, { IGameSession } from '../models/GameSession';

const router = Router();

interface MemoryBody {
  playerId: string;
  data: Record<string, any>;
}

interface MatchBody {
  playerId: string;
  gameType: GameType;
  won: boolean;
  duration: number;
}

router.get('/memory/:playerId/:gameType', async (req: Request, res: Response): Promise<void> => {
  try {
    const { playerId, gameType } = req.params;

    const memory = await GameMemory.findOne({
      playerId,
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

router.post('/memory/:playerId/:gameType', async (req: Request, res: Response): Promise<void> => {
  try {
    const { playerId, gameType } = req.params;
    const { data } = req.body as MemoryBody;

    if (!data) {
      res.status(400).json({ error: 'data is required' });
      return;
    }

    let memory = await GameMemory.findOne({
      playerId,
      gameType: gameType as GameType,
    });

    if (!memory) {
      memory = new GameMemory({
        playerId,
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

router.post('/match', async (req: Request, res: Response): Promise<void> => {
  try {
    const { playerId, gameType, won, duration } = req.body as MatchBody;

    if (!playerId || !gameType || typeof won !== 'boolean' || !duration) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const lastSession = await GameSession.findOne({
      playerId,
      gameType,
    }).sort({ matchNumber: -1 });

    const matchNumber = (lastSession?.matchNumber || 0) + 1;

    const session = new GameSession({
      playerId,
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

router.get('/stats/:playerId/:gameType', async (req: Request, res: Response) => {
  try {
    const { playerId, gameType } = req.params;

    const sessions = await GameSession.find({
      playerId,
      gameType: gameType as GameType,
    });

    const wins = sessions.filter((s) => s.won).length;
    const total = sessions.length;
    const winRate = total > 0 ? (wins / total) * 100 : 0;

    res.json({
      playerId,
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
