import { Router, Request, Response } from 'express';
import Player from '../models/Player';

const router = Router();

interface AuthBody {
  sessionId: string;
  name: string;
}

router.post('/player', async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId, name } = req.body as AuthBody;

    if (!sessionId || !name) {
      res.status(400).json({ error: 'sessionId and name are required' });
      return;
    }

    let player = await Player.findOne({ sessionId });

    if (!player) {
      player = new Player({
        sessionId,
        name,
      });
      await player.save();
    }

    res.json({
      id: player._id,
      sessionId: player.sessionId,
      name: player.name,
    });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Failed to authenticate player' });
  }
});

router.get('/player/:sessionId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;

    const player = await Player.findOne({ sessionId });

    if (!player) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }

    res.json({
      id: player._id,
      sessionId: player.sessionId,
      name: player.name,
    });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Failed to fetch player' });
  }
});

export default router;
