import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';

export type StaffRole = 'MANAGER' | 'SECURITY';

export interface AuthenticatedRequest extends Request {
  admin?: {
    id: string;
    username: string;
    full_name: string;
    email: string;
    role: StaffRole;
    must_change_password: boolean;
  };
}

function isStaffRole(value: unknown): value is StaffRole {
  return value === 'MANAGER' || value === 'SECURITY';
}

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. No Bearer token provided.' });
    return;
  }

  const token = authHeader.split(' ')[1];
  let decoded: any;
  try {
    decoded = jwt.verify(token, config.jwtSecret) as any;
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired authentication session.' });
    return;
  }
  // The role is never trusted from the JWT alone: the authoritative account
  // record is re-read on every request so deactivation takes effect
  // immediately, even for previously issued tokens.
  try {
    const db = getDb();
    const account = db.prepare('SELECT id, username, full_name, email, role, is_active, must_change_password FROM admin_users WHERE id = ?').get(decoded.id) as any;
    if (!account || account.is_active !== 1) {
      res.status(401).json({ error: 'This staff account is no longer active.' });
      return;
    }
    if (!isStaffRole(account.role)) {
      res.status(401).json({ error: 'This staff account has an unrecognized role.' });
      return;
    }
    req.admin = {
      id: account.id,
      username: account.username,
      full_name: account.full_name,
      email: account.email,
      role: account.role,
      must_change_password: account.must_change_password === 1
    };
    next();
  } catch (err) {
    res.status(401).json({ error: 'Unable to verify staff session.' });
  }
}

/** Backend password-freshness gate. SECURITY accounts flagged for a mandatory
 * password change may only identify themselves (/me) and change their own
 * password; every other protected endpoint answers 403 PASSWORD_CHANGE_REQUIRED.
 * MANAGER accounts are never subject to this restriction. */
export function requirePasswordFresh(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.admin) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (req.admin.role === 'SECURITY' && req.admin.must_change_password) {
    res.status(403).json({ error: 'You must change your temporary password before using the scanner.', code: 'PASSWORD_CHANGE_REQUIRED' });
    return;
  }
  next();
}

/** Manager-only endpoints: full administration (residents, payments, photos, issuance, reports). */
export function requireManager(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.admin) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (req.admin.role === 'SECURITY' && req.admin.must_change_password) {
    requirePasswordFresh(req, res, next);
    return;
  }
  if (req.admin.role !== 'MANAGER') {
    res.status(403).json({ error: 'Manager privileges are required for this action.' });
    return;
  }
  next();
}

/** Authorized scan endpoints: MANAGER and SECURITY roles (gate verification). */
export function requireScanRole(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.admin) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (req.admin.role !== 'MANAGER' && req.admin.role !== 'SECURITY') {
    res.status(403).json({ error: 'Staff scan privileges are required for this action.' });
    return;
  }
  requirePasswordFresh(req, res, next);
}
