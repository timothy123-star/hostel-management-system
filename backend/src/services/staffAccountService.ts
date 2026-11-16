import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { SECURITY_PASSWORD_MIN_LENGTH } from '@hostel/shared';
import { getDb } from '../db/connection.js';

export interface SecurityAccountInput {
  username: string;
  password: string;
  full_name: string;
  email?: string;
}

/** Manager-only creation of an individual SECURITY account. The temporary
 * password is hashed with bcrypt-12 and never stored or logged in plaintext;
 * the account is flagged for a mandatory first-login password change. */
export async function createSecurityAccount(input: SecurityAccountInput) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(input.username);
  if (existing) throw Object.assign(new Error('That login name is already taken.'), { status: 409 });
  if (!input.password || input.password.length < SECURITY_PASSWORD_MIN_LENGTH) throw Object.assign(new Error('Temporary password must be at least 12 characters.'), { status: 400 });
  const passwordHash = await bcrypt.hash(input.password, 12);
  const id = `security-${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO admin_users (id, username, password_hash, full_name, email, role, is_active, must_change_password, created_at)
    VALUES (?, ?, ?, ?, ?, 'SECURITY', 1, 1, datetime('now'))`)
    .run(id, input.username, passwordHash, input.full_name, input.email || `${input.username}@security.local`);
  return { id, username: input.username, full_name: input.full_name, role: 'SECURITY', is_active: 1, must_change_password: true };
}

export interface PasswordChangeInput {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

/** Self-service change for the caller's own row only. There is no target id,
 * role or active-status parameter, so one account can never affect another.
 * Hash update and flag clearance happen atomically. */
export async function changeOwnPassword(adminId: string, input: PasswordChangeInput) {
  if (!input.current_password) throw Object.assign(new Error('Current password is required.'), { status: 401 });
  if (!input.new_password || input.new_password.length < SECURITY_PASSWORD_MIN_LENGTH) throw Object.assign(new Error('The new password must be at least 12 characters.'), { status: 400 });
  if (input.new_password !== input.confirm_password) throw Object.assign(new Error('The new passwords do not match.'), { status: 400 });
  const db = getDb();
  const user = db.prepare('SELECT password_hash FROM admin_users WHERE id = ?').get(adminId) as any;
  if (!user) throw Object.assign(new Error('Staff account not found.'), { status: 401 });
  const ok = await bcrypt.compare(input.current_password, user.password_hash);
  if (!ok) throw Object.assign(new Error('Current password is incorrect.'), { status: 401 });
  if (input.current_password === input.new_password) throw Object.assign(new Error('The new password must be different.'), { status: 400 });
  const passwordHash = await bcrypt.hash(input.new_password, 12);
  db.transaction(() => {
    db.prepare('UPDATE admin_users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
      .run(passwordHash, adminId);
  })();
  const updated = db.prepare('SELECT id, username, full_name, email, role, is_active, must_change_password, created_at FROM admin_users WHERE id = ?').get(adminId) as any;
  return { ...(updated as any), must_change_password: false };
}
