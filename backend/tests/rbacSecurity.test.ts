import { beforeEach, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import { runSeed } from '../src/db/seed.js';
import { getDb } from '../src/db/connection.js';
import { config } from '../src/config.js';
import { authMiddleware, requireManager, requireScanRole } from '../src/middleware/authMiddleware.js';
import { QRService } from '../src/services/qrService.js';
import { StudentPhotoService } from '../src/services/studentPhotoService.js';
import { qrRouter } from '../src/routes/qrRoutes.js';
import { authRouter } from '../src/routes/authRoutes.js';

const adminId = 'admin-root-01';
const studentId = 'stu-demo-01';

const jpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0x01,
  0x11, 0x00, 0xff, 0xd9,
]);

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

function createSecurity(username = 'gate.north'): string {
  const db = getDb();
  const id = `security-${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO admin_users (id, username, password_hash, full_name, email, role, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, 'SECURITY', 1, datetime('now'))`)
    .run(id, username, bcrypt.hashSync('TempPassword123!', 10), 'North Gate Officer', `${username}@local`);
  return id;
}

function setupApproved() {
  const token = StudentPhotoService.issueUploadLink(studentId, adminId).uploadUrl.split('/').pop()!;
  StudentPhotoService.submitPhoto(token, jpeg);
  StudentPhotoService.reviewPhoto(studentId, 'APPROVED', adminId);
  return QRService.issueCredential(studentId, adminId);
}

function routed(router: any) {
  return (router.stack as any[])
    .filter((l: any) => l.route)
    .map((l: any) => ({
      path: l.route.path as string,
      methods: Object.keys(l.route.methods).map((m: string) => m.toUpperCase()),
      middlewares: ((l.route.stack as any[]) || []).map((s: any) => s.name || s.handle?.name),
    }));
}

describe('role-based access control', () => {
  beforeEach(async () => {
    await runSeed(true);
    fs.rmSync(config.photoStorageDir, { recursive: true, force: true });
  });

  it('keeps the seeded administrator as an active MANAGER', () => {
    const row = getDb().prepare('SELECT role, is_active FROM admin_users WHERE id = ?').get(adminId) as any;
    expect(row.role).toBe('MANAGER');
    expect(row.is_active).toBe(1);
  });

  it('authenticates a legacy JWT without a role claim as MANAGER from the database', () => {
    const legacy = sign({ id: adminId, username: 'admin', full_name: 'GM', email: 'm@local' });
    const { req, nexted } = runAuth(legacy);
    expect(nexted).toBe(true);
    expect(req.admin.role).toBe('MANAGER');
  });

  it('rejects unauthenticated requests with 401 and never calls through', () => {
    const { res, nexted } = runAuth(undefined);
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('ignores a tampered role claim and enforces the database role', () => {
    const secId = createSecurity();
    // SECURITY account presenting a MANAGER claim stays SECURITY.
    const forged = sign({ id: secId, username: 'gate.north', role: 'MANAGER' });
    const tampered = runAuth(forged);
    expect(tampered.nexted).toBe(true);
    expect(tampered.req.admin.role).toBe('SECURITY');
    expect(runGate(requireManager, tampered.req.admin).nexted).toBe(false);
    // MANAGER account presenting a SECURITY claim stays MANAGER.
    const downgraded = runAuth(sign({ id: adminId, username: 'admin', role: 'SECURITY' }));
    expect(downgraded.req.admin.role).toBe('MANAGER');
    expect(runGate(requireManager, downgraded.req.admin).nexted).toBe(true);
  });

  it('lets MANAGER reach both manager and scan endpoints; SECURITY only scan endpoints', () => {
    expect(runGate(requireManager, { role: 'MANAGER' }).nexted).toBe(true);
    expect(runGate(requireScanRole, { role: 'MANAGER' }).nexted).toBe(true);
    expect(runGate(requireManager, { role: 'SECURITY' }).nexted).toBe(false);
    expect(runGate(requireManager, { role: 'SECURITY' }).res.statusCode).toBe(403);
    expect(runGate(requireScanRole, { role: 'SECURITY' }).nexted).toBe(true);
  });

  it('locks out a deactivated SECURITY account immediately, including live tokens', () => {
    const secId = createSecurity();
    const token = sign({ id: secId, username: 'gate.north', role: 'SECURITY' });
    expect(runAuth(token).nexted).toBe(true);
    getDb().prepare('UPDATE admin_users SET is_active = 0 WHERE id = ?').run(secId);
    const after = runAuth(token);
    expect(after.nexted).toBe(false);
    expect(after.res.statusCode).toBe(401);
  });

  it('wires every QR manager route behind requireManager and scan routes behind requireScanRole', () => {
    const routes = routed(qrRouter);
    for (const r of routes) {
      if (['/staff/:token', '/staff/:token/photo', '/verify'].includes(r.path)) {
        expect(r.middlewares).toContain('requireScanRole');
        expect(r.middlewares).not.toContain('requireManager');
      } else {
        expect(r.middlewares).toContain('requireManager');
      }
    }
    const accountRoutes = routed(authRouter);
    const create = accountRoutes.find((r) => r.path === '/security-accounts' && r.methods.includes('POST'));
    expect(create?.middlewares).toContain('requireManager');
    const patch = accountRoutes.find((r) => r.path === '/security-accounts/:id');
    expect(patch?.middlewares).toContain('requireManager');
  });
});

describe('server-side QR verification outcomes', () => {
  beforeEach(async () => {
    await runSeed(true);
    fs.rmSync(config.photoStorageDir, { recursive: true, force: true });
  });

  it('rejects fabricated and unknown credentials with no resident data', () => {
    const res: any = QRService.verifyToken('not-a-valid-credential', 'MANAGER', 'MANUAL_ENTRY', adminId, 'MANAGER');
    expect(res.outcome).toBe('DENIED');
    expect(res.status).toBe('INVALID_CREDENTIAL');
    expect(res.student).toBeUndefined();
  });

  it('rejects revoked credentials without resident data', () => {
    const issued = setupApproved();
    QRService.revokeCredential(issued.credential.id, 'Gate test revocation', adminId);
    const res: any = QRService.verifyToken(issued.token, 'MANAGER', 'MANUAL_ENTRY', adminId, 'MANAGER');
    expect(res.outcome).toBe('DENIED');
    expect(res.status).toBe('INVALID_CREDENTIAL');
    expect(res.student).toBeUndefined();
  });

  it('reports expired credentials as EXPIRED', () => {
    const issued = setupApproved();
    getDb().prepare("UPDATE resident_qr_credentials SET status = 'EXPIRED' WHERE id = ?").run(issued.credential.id);
    const res: any = QRService.verifyToken(issued.token, 'MANAGER', 'MANUAL_ENTRY', adminId, 'MANAGER');
    expect(res.outcome).toBe('DENIED');
    expect(res.status).toBe('EXPIRED');
  });

  it('requires verified payment and allocation (bank matching alone is not approval)', () => {
    const issued = setupApproved();
    getDb().prepare("UPDATE payments SET status = 'PENDING' WHERE student_id = ?").run(studentId);
    const res: any = QRService.verifyToken(issued.token, 'MANAGER', 'MANUAL_ENTRY', adminId, 'SECURITY');
    expect(res.outcome).toBe('DENIED');
    expect(res.status).toBe('ATTENTION_REQUIRED');
    expect(res.reason).toMatch(/verified payment/i);
  });

  it('grants a valid resident with the approved photo and no phone or financial data', () => {
    const issued = setupApproved();
    const res: any = QRService.getPublicVerification(issued.token, 'MANAGER', adminId, 'SECURITY');
    expect(res.status).toBe('VALID_RESIDENT');
    expect(res.student.full_name).toBeTruthy();
    expect(res.photo_url).toContain('/api/qr/staff/');
    const serialized = JSON.stringify(res);
    const phone = (getDb().prepare('SELECT phone_number FROM students WHERE id = ?').get(studentId) as any).phone_number;
    expect(serialized).not.toContain(phone);
    expect(serialized).not.toContain('PAY-REF');
    expect(serialized).not.toContain('consent');
  });
});

describe('scan audit trail', () => {
  beforeEach(async () => {
    await runSeed(true);
    fs.rmSync(config.photoStorageDir, { recursive: true, force: true });
  });

  it('logs successful and failed scans with staff role and fingerprint, never the raw token', () => {
    const issued = setupApproved();
    QRService.verifyToken(issued.token, 'MANAGER', 'CAMERA', adminId, 'MANAGER');
    QRService.verifyToken('bogus-token-xyz', 'MANAGER', 'CAMERA', adminId, 'SECURITY');
    const rows = getDb().prepare('SELECT outcome, staff_role, credential_fingerprint FROM access_logs ORDER BY logged_at ASC').all() as any[];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]).toMatchObject({ outcome: 'GRANTED', staff_role: 'MANAGER' });
    const denied = rows.find((r) => r.outcome === 'DENIED');
    expect(denied.staff_role).toBe('SECURITY');
    const dumped = JSON.stringify(getDb().prepare('SELECT * FROM access_logs').all());
    expect(dumped).not.toContain('bogus-token-xyz');
    expect(dumped).not.toContain(issued.token);
  });

  it('flags one credential used by different staff close together without blocking repeats', () => {
    const issued = setupApproved();
    const secId = createSecurity('gate.south');
    const first: any = QRService.verifyToken(issued.token, 'MANAGER', 'CAMERA', adminId, 'MANAGER');
    const second: any = QRService.verifyToken(issued.token, 'MANAGER', 'CAMERA', secId, 'SECURITY');
    expect(first.outcome).toBe('GRANTED');
    expect(second.outcome).toBe('GRANTED');
    const audit = QRService.getScanAudit(50);
    expect(audit.flags.some((f) => f.kind === 'SHARED_CREDENTIAL_USE')).toBe(true);
  });

  it('flags repeated invalid attempts', () => {
    for (let i = 0; i < 5; i++) {
      QRService.verifyToken('same-bogus-token', 'MANAGER', 'CAMERA', adminId, 'SECURITY');
    }
    const audit = QRService.getScanAudit(50);
    expect(audit.flags.some((f) => f.kind === 'REPEATED_INVALID_ATTEMPTS')).toBe(true);
  });
});
