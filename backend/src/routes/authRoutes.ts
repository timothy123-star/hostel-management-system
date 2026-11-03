import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDb } from '../db/connection.js';
import { config } from '../config.js';
import { LoginSchema } from '@hostel/shared';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware.js';

export const authRouter = Router();

authRouter.post('/login', async (req, res, next) => {
  try {
    const input = LoginSchema.parse(req.body);
    const db = getDb();

    const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(input.username) as any;
    if (!user) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    const isMatch = await bcrypt.compare(input.password, user.password_hash);
    if (!isMatch) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        email: user.email
      },
      config.jwtSecret,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        email: user.email,
        created_at: user.created_at
      }
    });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', authMiddleware, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.admin });
});
