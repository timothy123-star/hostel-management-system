import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export interface AuthenticatedRequest extends Request {
  admin?: {
    id: string;
    username: string;
    full_name: string;
    email: string;
  };
}

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. No Bearer token provided.' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as any;
    req.admin = {
      id: decoded.id,
      username: decoded.username,
      full_name: decoded.full_name,
      email: decoded.email
    };
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired authentication session.' });
  }
}
