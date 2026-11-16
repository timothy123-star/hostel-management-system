import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { config } from '../config.js';
import { LoginSchema, SECURITY_PASSWORD_MIN_LENGTH } from '@hostel/shared';
import { authMiddleware, requireManager, AuthenticatedRequest, StaffRole } from '../middleware/authMiddleware.js';
import { createSecurityAccount, changeOwnPassword } from '../services/staffAccountService.js';

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
    if (user.is_active !== 1) {
      res.status(401).json({ error: 'This staff account has been deactivated.' });
      return;
    }

    const isMatch = await bcrypt.compare(input.password, user.password_hash);
    if (!isMatch) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    const role: StaffRole = user.role === 'SECURITY' ? 'SECURITY' : 'MANAGER';
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        email: user.email,
        role
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
        role,
        must_change_password: (user.must_change_password ?? 0) === 1,
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

export const SecurityAccountSchema = z.object({
  username: z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9_.-]+$/, 'Letters, digits, dot, dash and underscore only.'),
  password: z.string().min(SECURITY_PASSWORD_MIN_LENGTH, 'Temporary password must be at least 12 characters.').max(128),
  full_name: z.string().trim().min(2).max(100).regex(/^[\p{L}\p{M} .'\-]+$/u, 'Enter a valid display name.'),
  email: z.string().trim().email().max(160).optional()
});

/** Manager-only: list staff accounts (never exposes password hashes). */
authRouter.get('/security-accounts', authMiddleware, requireManager, (req, res, next) => {
  try {
    const rows = getDb().prepare(
      'SELECT id, username, full_name, email, role, is_active, must_change_password, created_at FROM admin_users ORDER BY created_at ASC'
    ).all();
    res.json({ accounts: rows });
  } catch (err) { next(err); }
});

/** Manager-only: create an individual SECURITY account (no shared passwords). */
authRouter.post('/security-accounts', authMiddleware, requireManager, async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = SecurityAccountSchema.parse(req.body);
    const account = await createSecurityAccount({ username: input.username, password: input.password, full_name: input.full_name, email: input.email });
    res.status(201).json({ account });
  } catch (err) { next(err); }
});

/** Manager-only: deactivate (or reactivate) a SECURITY account. */
authRouter.patch('/security-accounts/:id', authMiddleware, requireManager, (req: AuthenticatedRequest, res, next) => {
  try {
    const active = z.object({ is_active: z.boolean() }).parse(req.body);
    const db = getDb();
    const target = db.prepare('SELECT id, role FROM admin_users WHERE id = ?').get(req.params.id) as any;
    if (!target) {
      res.status(404).json({ error: 'Staff account not found.' });
      return;
    }
    if (target.role !== 'SECURITY') {
      res.status(400).json({ error: 'Only SECURITY accounts can be changed here.' });
      return;
    }
    if (target.id === req.admin!.id) {
      res.status(400).json({ error: 'You cannot change your own account here.' });
      return;
    }
    db.prepare('UPDATE admin_users SET is_active = ? WHERE id = ?').run(active.is_active ? 1 : 0, target.id);
    res.json({ account: { id: target.id, is_active: active.is_active } });
  } catch (err) { next(err); }
});

export const PasswordChangeSchema = z.object({
  current_password: z.string().min(1).max(256),
  new_password: z.string().min(SECURITY_PASSWORD_MIN_LENGTH, 'The new password must be at least 12 characters.').max(128),
  confirm_password: z.string().min(SECURITY_PASSWORD_MIN_LENGTH, 'The new password must be at least 12 characters.').max(128)
});

/** Self-service password change. Deliberately reachable while a mandatory
 * change is pending: this is the only endpoint that can clear the flag.
 * It can only ever affect the caller's own row — no target id, role or
 * active-status fields are accepted. */
authRouter.patch('/password', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = PasswordChangeSchema.parse(req.body);
    const user = await changeOwnPassword(req.admin!.id, input);
    res.json({ success: true, user });
  } catch (err) { next(err); }
});
