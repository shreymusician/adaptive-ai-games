import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import Player from '../models/Player';
import { signToken } from '../utils/jwt';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const SALT_ROUNDS = 10;

const toPublicUser = (player: { _id: unknown; email: string; name: string }) => ({
  id: player._id,
  email: player.email,
  name: player.name,
});

interface SignupBody {
  email: string;
  password: string;
  name: string;
}

interface LoginBody {
  email: string;
  password: string;
}

interface GoogleAuthBody {
  idToken: string;
}

router.post('/auth/signup', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, name } = req.body as SignupBody;

    if (!email || !password || !name) {
      res.status(400).json({ error: 'email, password and name are required' });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    const existing = await Player.findOne({ email: email.toLowerCase() });
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const player = await Player.create({ email: email.toLowerCase(), name, passwordHash });

    const token = signToken({ userId: String(player._id) });
    res.status(201).json({ token, user: toPublicUser(player) });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

router.post('/auth/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body as LoginBody;

    if (!email || !password) {
      res.status(400).json({ error: 'email and password are required' });
      return;
    }

    const player = await Player.findOne({ email: email.toLowerCase() });
    if (!player || !player.passwordHash) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const valid = await bcrypt.compare(password, player.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = signToken({ userId: String(player._id) });
    res.json({ token, user: toPublicUser(player) });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to log in' });
  }
});

router.post('/auth/google', async (req: Request, res: Response): Promise<void> => {
  try {
    const { idToken } = req.body as GoogleAuthBody;

    if (!idToken) {
      res.status(400).json({ error: 'idToken is required' });
      return;
    }

    if (!process.env.GOOGLE_CLIENT_ID) {
      res.status(500).json({ error: 'Google Sign-In is not configured on the server' });
      return;
    }

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    if (!payload?.sub || !payload.email) {
      res.status(401).json({ error: 'Invalid Google token' });
      return;
    }

    const { sub: googleId, email, name } = payload;

    let player = await Player.findOne({ googleId });

    if (!player) {
      player = await Player.findOne({ email: email.toLowerCase() });
      if (player) {
        player.googleId = googleId;
        await player.save();
      }
    }

    if (!player) {
      player = await Player.create({
        email: email.toLowerCase(),
        name: name || email.split('@')[0],
        googleId,
      });
    }

    const token = signToken({ userId: String(player._id) });
    res.json({ token, user: toPublicUser(player) });
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(401).json({ error: 'Google authentication failed' });
  }
});

router.get('/auth/me', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const player = await Player.findById(req.userId);
    if (!player) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ user: toPublicUser(player) });
  } catch (error) {
    console.error('Me error:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

export default router;
