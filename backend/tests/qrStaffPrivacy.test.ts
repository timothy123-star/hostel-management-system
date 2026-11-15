import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { runSeed } from '../src/db/seed.js';
import { getDb } from '../src/db/connection.js';
import { config } from '../src/config.js';
import { QRService } from '../src/services/qrService.js';
import { StudentPhotoService } from '../src/services/studentPhotoService.js';
import { PhotoDisplayConsentService } from '../src/services/photoDisplayConsentService.js';
import { qrRouter } from '../src/routes/qrRoutes.js';

const adminId = 'admin-root-01';
const studentId = 'stu-demo-01';

const jpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0x01,
  0x11, 0x00, 0xff, 0xd9,
]);

function routed() {
  return (qrRouter.stack as any[])
    .filter((l) => l.route)
    .map((l) => ({
      path: l.route.path as string,
      methods: Object.keys(l.route.methods).map((m) => m.toUpperCase()),
      middlewares: ((l.route.stack as any[]) || []).map((s) => s.name || s.handle?.name),
    }));
}

function setupApproved() {
  const token = StudentPhotoService.issueUploadLink(studentId, adminId).uploadUrl.split('/').pop()!;
  StudentPhotoService.submitPhoto(token, jpeg);
  StudentPhotoService.reviewPhoto(studentId, 'APPROVED', adminId);
  return QRService.issueCredential(studentId, adminId);
}

describe('staff-only QR identity and photo retrieval', () => {
  beforeEach(async () => {
    await runSeed(true);
    fs.rmSync(config.photoStorageDir, { recursive: true, force: true });
  });

  it('exposes no public or bearer-only identity/photo route', () => {
    const routes = routed();
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      expect(r.path.includes('public')).toBe(false);
      expect(r.path.includes('verify-page')).toBe(false);
    }
    const reads = routes.filter((r) => r.methods.includes('GET'));
    const paths = reads.map((r) => r.path);
    expect(paths).toContain('/staff/:token');
    expect(paths).toContain('/staff/:token/photo');
    // Every staff GET route (identity, photo, credentials, audit) requires auth.
    for (const r of reads) expect(r.middlewares).toContain('authMiddleware');
    const verify = routes.find((r) => r.path === '/verify');
    expect(verify?.middlewares).toContain('authMiddleware');
  });

  it('denies invalid, unissued and revoked credentials without identity data', () => {
    const bad: any = QRService.verifyToken('not-a-valid-token-1234567890123456789', 'MANAGER', 'MANUAL_ENTRY', adminId);
    expect(bad.outcome).toBe('DENIED');
    expect(bad.student).toBeUndefined();
    expect(QRService.getPublicVerification('not-a-valid-token-1234567890123456789').status).toBe('INVALID_CREDENTIAL');
    expect(() => QRService.getVerifiedPhoto('not-a-valid-token-1234567890123456789', 'MANAGER', adminId)).toThrow();

    const issued = setupApproved();
    QRService.revokeCredential((issued.credential as any).id, 'lost pass', adminId);
    const revoked: any = QRService.verifyToken(issued.token, 'MANAGER', 'MANUAL_ENTRY', adminId);
    expect(revoked.outcome).toBe('DENIED');
    expect(revoked.student).toBeUndefined();
    expect(() => QRService.getVerifiedPhoto(issued.token, 'MANAGER', adminId)).toThrow();
  });

  it('authorized staff receive photo plus permitted identity fields only', () => {
    const issued = setupApproved();
    const result: any = QRService.verifyToken(issued.token, 'MANAGER', 'CAMERA', adminId);
    expect(result.outcome).toBe('GRANTED');
    expect(result.student.full_name).toBeTruthy();
    expect(result.student.department).toBeTruthy();
    expect(result.hostel?.name).toBeTruthy();
    expect(result.room?.room_number).toBe('M-101');
    expect(result.allocation?.start_date).toBeTruthy();
    expect(typeof result.student.photo_url).toBe('string');
    expect(result.student.photo_url).toContain('/api/qr/staff/');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('+15551001001');
    expect(serialized).not.toContain('15551001001');
    expect(serialized.toLowerCase()).not.toContain('payment');
    expect(serialized).not.toContain('token_ciphertext');
    expect(serialized).not.toContain('consent_random_matching');
    expect(serialized).not.toContain('photo_display_consents');
  });

  it('staff verification payload carries no secrets beyond the scanned credential', () => {
    const issued = setupApproved();
    const pub: any = QRService.getPublicVerification(issued.token, 'MANAGER', adminId);
    expect(pub.status).toBe('VALID_RESIDENT');
    expect(pub.photo_url).toContain('/api/qr/staff/');
    const serialized = JSON.stringify(pub);
    expect(serialized).not.toContain('+15551001001');
    expect(serialized.toLowerCase()).not.toContain('payment');
  });

  it('withdrawal and revocation take effect on subsequent scans', () => {
    const issued = setupApproved();
    expect((QRService.getPublicVerification(issued.token, 'MANAGER', adminId) as any).photo_display).toBe('CONSENTED');
    PhotoDisplayConsentService.recordDecision({ studentId, decision: 'WITHDRAWN', decidedBy: 'MANAGER', adminId, notes: 'takedown' });
    const withheld: any = QRService.getPublicVerification(issued.token, 'MANAGER', adminId);
    expect(withheld.photo_display).toBe('WITHHELD');
    expect(withheld.photo_url).toBeUndefined();
    QRService.revokeCredential((issued.credential as any).id, 'stolen', adminId);
    expect((QRService.getPublicVerification(issued.token, 'MANAGER', adminId) as any).status).toBe('INVALID_CREDENTIAL');
  });

  it('approved photographs live outside any publicly served directory', () => {
    const frontendDist = path.resolve(__dirname, '../../frontend/dist');
    const rel = path.relative(frontendDist, path.resolve(config.photoStorageDir));
    expect(rel.startsWith('..')).toBe(true);
    const dbRel = path.relative(frontendDist, path.resolve(config.dbPath));
    expect(dbRel.startsWith('..')).toBe(true);
  });

  it('manager review image access stays authenticated', async () => {
    const { studentPhotoRouter } = await import('../src/routes/studentPhotoRoutes.js');
    const gets = (studentPhotoRouter.stack as any[])
      .filter((l) => l.route && Object.keys(l.route.methods).includes('get'))
      .map((l) => ({ path: l.route.path as string, middlewares: ((l.route.stack as any[]) || []).map((s) => s.name) }));
    const image = gets.find((g) => g.path === '/photo-reviews/:studentId/image');
    expect(image?.middlewares).toContain('authMiddleware');
  });
});
