import { beforeEach, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runSeed } from '../src/db/seed.js';
import { getDb } from '../src/db/connection.js';
import { config } from '../src/config.js';
import { authMiddleware, requireManager, requireScanRole } from '../src/middleware/authMiddleware.js';
import { createSecurityAccount, changeOwnPassword } from '../src/services/staffAccountService.js';
import { authRouter, SecurityAccountSchema, PasswordChangeSchema } from '../src/routes/authRoutes.js';
import { SECURITY_PASSWORD_MIN_LENGTH } from '@hostel/shared';

const adminId = 'admin-root-01';
const TEMP = 'TemporaryPass123!';

function sign(payload: any) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '7d' });
}

function mockReq(token?: string): any {
  return { headers: token ? { authorization: `Bearer ${token}` } : {}, admin: undefined };
}

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: any) => { res.body = body; return res; };
  return res;
}

function runAuth(token?: string) {
  const req = mockReq(token);
  const res = mockRes();
  let nexted = false;
  authMiddleware(req, res, () => { nexted = true; });
  return { req, res, nexted };
}

function runGate(mw: any, admin: any) {
  const req: any = { admin };
  const res = mockRes();
  let nexted = false;
  mw(req, res, () => { nexted = true; });
  return { req, res, nexted };
}

function tag() {
  return crypto.randomUUID().slice(0, 8);
}

describe('mandatory SECURITY password change', () => {
  beforeEach(async () => {
    await runSeed(true);
  });

  it('new SECURITY accounts are flagged and store only a bcrypt hash', async () => {
    const t = tag();
    const account = await createSecurityAccount({ username: `gate.${t}`, password: TEMP, full_name: 'North Gate Officer' });
    expect(account.must_change_password).toBe(true);
    expect(account.role).toBe('SECURITY');
    const row = getDb().prepare('SELECT * FROM admin_users WHERE id = ?').get(account.id) as any;
    expect(row.must_change_password).toBe(1);
    expect(row.role).toBe('SECURITY');
    expect(row.password_hash).not.toBe(TEMP);
    expect(await bcrypt.compare(TEMP, row.password_hash)).toBe(true);
  });

  it('MANAGER accounts are unaffected by the flag', () => {
    const row = getDb().prepare('SELECT * FROM admin_users WHERE id = ?').get(adminId) as any;
    expect(row.role).toBe('MANAGER');
    expect(row.must_change_password).toBe(0);
  });

  it('flagged SECURITY passes identity check but is blocked from scan and manager endpoints', async () => {
    const t = tag();
    const account = await createSecurityAccount({ username: `gate.${t}`, password: TEMP, full_name: 'Gate Officer' });
    const token = sign({ id: account.id, username: account.username, role: 'SECURITY' });
    const auth = runAuth(token);
    expect(auth.nexted).toBe(true);
    expect(auth.req.admin.must_change_password).toBe(true);
    const scan = runGate(requireScanRole, auth.req.admin);
    expect(scan.nexted).toBe(false);
    expect(scan.res.statusCode).toBe(403);
    expect(scan.res.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    const mgr = runGate(requireManager, auth.req.admin);
    expect(mgr.nexted).toBe(false);
    expect(mgr.res.statusCode).toBe(403);
    expect(mgr.res.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('a forged JWT role claim cannot bypass the database flag', async () => {
    const t = tag();
    const account = await createSecurityAccount({ username: `gate.${t}`, password: TEMP, full_name: 'Gate Officer' });
    const forged = sign({ id: account.id, username: account.username, role: 'MANAGER' });
    const auth = runAuth(forged);
    expect(auth.nexted).toBe(true);
    expect(auth.req.admin.role).toBe('SECURITY');
    expect(runGate(requireManager, auth.req.admin).res.statusCode).toBe(403);
    const scan = runGate(requireScanRole, auth.req.admin);
    expect(scan.nexted).toBe(false);
    expect(scan.res.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('deactivated SECURITY accounts stay rejected even before the flag is checked', async () => {
    const t = tag();
    const account = await createSecurityAccount({ username: `gate.${t}`, password: TEMP, full_name: 'Gate Officer' });
    getDb().prepare('UPDATE admin_users SET is_active = 0 WHERE id = ?').run(account.id);
    const auth = runAuth(sign({ id: account.id, role: 'SECURITY' }));
    expect(auth.nexted).toBe(false);
    expect(auth.res.statusCode).toBe(401);
  });

  it('MANAGER accounts retain full scan and admin access', () => {
    const auth = runAuth(sign({ id: adminId, role: 'MANAGER' }));
    expect(auth.nexted).toBe(true);
    expect(auth.req.admin.must_change_password).toBe(false);
    expect(runGate(requireManager, auth.req.admin).nexted).toBe(true);
    expect(runGate(requireScanRole, auth.req.admin).nexted).toBe(true);
  });

  it('successful self-service change clears the flag and rotates the hash', async () => {
    const t = tag();
    const account = await createSecurityAccount({ username: `gate.${t}`, password: TEMP, full_name: 'Gate Officer' });
    const updated = await changeOwnPassword(account.id, { current_password: TEMP, new_password: 'BrandNewPass456!', confirm_password: 'BrandNewPass456!' });
    expect(updated.must_change_password).toBe(false);
    const row = getDb().prepare('SELECT * FROM admin_users WHERE id = ?').get(account.id) as any;
    expect(row.must_change_password).toBe(0);
    expect(await bcrypt.compare('BrandNewPass456!', row.password_hash)).toBe(true);
    expect(await bcrypt.compare(TEMP, row.password_hash)).toBe(false);
    const token = sign({ id: account.id, role: 'SECURITY' });
    const auth = runAuth(token);
    expect(auth.req.admin.must_change_password).toBe(false);
    expect(runGate(requireScanRole, auth.req.admin).nexted).toBe(true);
  });

  it('empty, weak, unchanged and mismatched passwords are rejected without clearing the flag', async () => {
    const t = tag();
    const account = await createSecurityAccount({ username: `gate.${t}`, password: TEMP, full_name: 'Gate Officer' });
    const bad = [
      { current_password: TEMP, new_password: '', confirm_password: '' },
      { current_password: TEMP, new_password: 'short1!', confirm_password: 'short1!' },
      { current_password: TEMP, new_password: TEMP, confirm_password: TEMP },
      { current_password: TEMP, new_password: 'BrandNewPass456!', confirm_password: 'DifferentPass789!' },
      { current_password: 'WrongCurrent999!', new_password: 'BrandNewPass456!', confirm_password: 'BrandNewPass456!' },
    ];
    for (const input of bad) {
      await expect(changeOwnPassword(account.id, input)).rejects.toThrow();
    }
    const row = getDb().prepare('SELECT * FROM admin_users WHERE id = ?').get(account.id) as any;
    expect(row.must_change_password).toBe(1);
    expect(await bcrypt.compare(TEMP, row.password_hash)).toBe(true);
  });

  it('password change is scoped to the caller and the route takes no target id', async () => {
    const t = tag();
    const a = await createSecurityAccount({ username: `gate-a.${t}`, password: TEMP, full_name: 'Officer A' });
    const b = await createSecurityAccount({ username: `gate-b.${t}`, password: TEMP, full_name: 'Officer B' });
    await changeOwnPassword(a.id, { current_password: TEMP, new_password: 'BrandNewPass456!', confirm_password: 'BrandNewPass456!' });
    const rowB = getDb().prepare('SELECT * FROM admin_users WHERE id = ?').get(b.id) as any;
    expect(rowB.must_change_password).toBe(1);
    expect(await bcrypt.compare(TEMP, rowB.password_hash)).toBe(true);
    const layers = (authRouter.stack as any[]).filter((l: any) => l.route && l.route.path === '/password');
    expect(layers.length).toBe(1);
    expect(layers[0].route.path).not.toContain(':id');
  });
});

describe('password-change migration and frontend guard (source-level)', () => {
  const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'src');
  const read = (root: string, ...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');

  it('sqlite upgrade backfills pre-existing SECURITY rows exactly once', () => {
    const conn = read(backendRoot, 'db', 'connection.ts');
    const addAt = conn.indexOf('must_change_password');
    expect(addAt).toBeGreaterThan(-1);
    const updateAt = conn.indexOf('UPDATE admin_users SET must_change_password');
    expect(updateAt).toBeGreaterThan(-1);
    const updateLine = conn.slice(updateAt, conn.indexOf('\n', updateAt));
    expect(updateLine).toContain('WHERE role = ');
    expect(updateLine).not.toContain('MANAGER');
    expect(conn.lastIndexOf('if (', updateAt)).toBeGreaterThan(-1);
  });

  it('postgres migration flags pre-existing SECURITY rows without touching MANAGER rows', () => {
    const sql = read(backendRoot, 'db', 'postgres', 'migrations', '0004_security_password_change.sql');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS must_change_password');
    expect(sql).toContain("WHERE role = 'SECURITY'");
  });

  it('flagged SECURITY logins are forced to the change-password screen with no scanner escape', () => {
    const app = read(frontendRoot, 'App.tsx');
    expect(app).toContain('must_change_password');
    expect(app).toContain('/security/change-password');
    expect(app).toContain('ForcePasswordChangePage');
    const login = read(frontendRoot, 'pages', 'LoginPage.tsx');
    expect(login).toContain('must_change_password');
    expect(login).toContain('/security/change-password');
    const force = read(frontendRoot, 'pages', 'ForcePasswordChangePage.tsx');
    expect(force).toContain('confirm');
  });

  it('MANAGER logins bypass the forced-change screen', () => {
    const app = read(frontendRoot, 'App.tsx');
    expect(app).toContain('!isManager');
  });
});

describe('12-character SECURITY password minimum', () => {
  beforeEach(async () => {
    await runSeed(true);
  });

  it('shared minimum is 12 characters', () => {
    expect(SECURITY_PASSWORD_MIN_LENGTH).toBe(12);
  });

  it('route schemas reject 10- and 11-character passwords but accept 12', () => {
    for (const short of ['Pass123456', 'Pass1234567']) {
      expect(short.length).toBeLessThan(12);
      expect(SecurityAccountSchema.safeParse({ username: 'gate.x', password: short, full_name: 'Gate Officer' }).success).toBe(false);
      expect(PasswordChangeSchema.safeParse({ current_password: 'TemporaryPass123!', new_password: short, confirm_password: short }).success).toBe(false);
    }
    const exact = 'Pass12345678';
    expect(exact.length).toBe(12);
    expect(SecurityAccountSchema.safeParse({ username: 'gate.x', password: exact, full_name: 'Gate Officer' }).success).toBe(true);
    expect(PasswordChangeSchema.safeParse({ current_password: 'TemporaryPass123!', new_password: exact, confirm_password: exact }).success).toBe(true);
  });

  it('creation service rejects short temporary passwords and accepts a 12-character one', async () => {
    const t = tag();
    await expect(createSecurityAccount({ username: `short10.${t}`, password: 'Pass123456', full_name: 'Gate Officer' })).rejects.toThrow(/at least 12/);
    await expect(createSecurityAccount({ username: `short11.${t}`, password: 'Pass1234567', full_name: 'Gate Officer' })).rejects.toThrow(/at least 12/);
    const account = await createSecurityAccount({ username: `exact12.${t}`, password: 'Pass12345678', full_name: 'Gate Officer' });
    expect(account.must_change_password).toBe(true);
    const row = getDb().prepare('SELECT * FROM admin_users WHERE id = ?').get(account.id) as any;
    expect(await bcrypt.compare('Pass12345678', row.password_hash)).toBe(true);
  });

  it('first-login change rejects short replacements and accepts 12 characters', async () => {
    const t = tag();
    const account = await createSecurityAccount({ username: `chg.${t}`, password: 'TemporaryPass123!', full_name: 'Gate Officer' });
    await expect(changeOwnPassword(account.id, { current_password: 'TemporaryPass123!', new_password: 'Pass1234567', confirm_password: 'Pass1234567' })).rejects.toThrow(/at least 12/);
    let row = getDb().prepare('SELECT * FROM admin_users WHERE id = ?').get(account.id) as any;
    expect(row.must_change_password).toBe(1);
    expect(await bcrypt.compare('TemporaryPass123!', row.password_hash)).toBe(true);
    const updated = await changeOwnPassword(account.id, { current_password: 'TemporaryPass123!', new_password: 'Pass12345678', confirm_password: 'Pass12345678' });
    expect(updated.must_change_password).toBe(false);
    row = getDb().prepare('SELECT * FROM admin_users WHERE id = ?').get(account.id) as any;
    expect(row.must_change_password).toBe(0);
    expect(await bcrypt.compare('Pass12345678', row.password_hash)).toBe(true);
  });

  it('manager authentication remains unaffected by the SECURITY minimum', () => {
    const auth = runAuth(sign({ id: adminId, role: 'MANAGER' }));
    expect(auth.nexted).toBe(true);
    expect(auth.req.admin.must_change_password).toBe(false);
    expect(runGate(requireManager, auth.req.admin).nexted).toBe(true);
  });
});
