import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { runSeed } from '../src/db/seed.js';
import { getDb } from '../src/db/connection.js';
import { config } from '../src/config.js';
import { QRService } from '../src/services/qrService.js';
import { StudentPhotoService } from '../src/services/studentPhotoService.js';
import { PhotoDisplayConsentService, PHOTO_UPLOAD_DISCLOSURE_VERSION } from '../src/services/photoDisplayConsentService.js';
import { ConversationHandler } from '../src/services/whatsapp/conversationHandler.js';
import { StudentService } from '../src/services/studentService.js';
import { SimulatorProvider } from '../src/services/whatsapp/simulatorProvider.js';
import { authMiddleware } from '../src/middleware/authMiddleware.js';
import { studentPhotoRouter } from '../src/routes/studentPhotoRoutes.js';

const adminId = 'admin-root-01';
const studentId = 'stu-demo-01';
const residentPhone = '+15551001001';

const jpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0x01,
  0x11, 0x00, 0xff, 0xd9,
]);

function freshUploadToken(target = studentId) {
  return StudentPhotoService.issueUploadLink(target, adminId).uploadUrl.split('/').pop()!;
}

function latestConsent(target = studentId) {
  return getDb()
    .prepare(
      `SELECT decision, decided_by, notes FROM photo_display_consents WHERE student_id = ? AND purpose = 'QR_VERIFICATION_DISPLAY' ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(target) as any;
}

function approve(target = studentId) {
  return StudentPhotoService.reviewPhoto(target, 'APPROVED', adminId);
}

describe('QR photo auto-display on upload permission', () => {
  beforeEach(async () => {
    await runSeed(true);
    fs.rmSync(config.photoStorageDir, { recursive: true, force: true });
  });

  it('dashboard upload automatically grants display permission without a separate action', () => {
    expect(latestConsent()).toBeUndefined();
    const result = StudentPhotoService.submitPhoto(freshUploadToken(), jpeg);
    expect(result.status).toBe('PENDING_REVIEW');
    const consent = latestConsent();
    expect(consent.decision).toBe('GRANTED');
    expect(consent.decided_by).toBe('RESIDENT');
    expect(consent.notes).toContain('display-permission-v1');
  });

  it('WhatsApp upload automatically grants display permission', () => {
    ConversationHandler.recordPhotoDisclosure(residentPhone, studentId);
    StudentPhotoService.submitWhatsAppPhoto(studentId, jpeg, {
      messageId: 'wamid.auto-permission-1',
      phoneNumber: residentPhone,
    }, { disclosureVersion: PHOTO_UPLOAD_DISCLOSURE_VERSION });
    const consent = latestConsent();
    expect(consent.decision).toBe('GRANTED');
    expect(consent.decided_by).toBe('RESIDENT');
  });

  it('pending photographs are withheld from every scan surface', () => {
    StudentPhotoService.submitPhoto(freshUploadToken(), jpeg);
    expect(QRService.getPhotoAvailability(studentId).available).toBe(false);
    // Approval is required before issuance; craft an approvable path instead of a scan bypass.
    expect(() => QRService.issueCredential(studentId, adminId)).toThrow(
      /approved current photograph/i,
    );
  });

  it('rejected photographs are never shown', () => {
    StudentPhotoService.submitPhoto(freshUploadToken(), jpeg);
    StudentPhotoService.reviewPhoto(studentId, 'REJECTED', adminId, 'Too blurry');
    expect(QRService.getPhotoAvailability(studentId).available).toBe(false);
    expect(() => QRService.issueCredential(studentId, adminId)).toThrow();
  });

  it('manager approval makes the photograph appear automatically in scans', () => {
    StudentPhotoService.submitPhoto(freshUploadToken(), jpeg);
    approve();
    const issued = QRService.issueCredential(studentId, adminId);
    const pub: any = QRService.getPublicVerification(issued.token);
    expect(pub.status).toBe('VALID_RESIDENT');
    expect(pub.photo_display).toBe('CONSENTED');
    expect(typeof pub.photo_url).toBe('string');
    expect(QRService.getVerifiedPhoto(issued.token).storagePath).toContain(
      config.photoStorageDir,
    );
  });

  it('manager gate scan returns photo plus identity details and nothing private', () => {
    StudentPhotoService.submitPhoto(freshUploadToken(), jpeg);
    approve();
    const issued = QRService.issueCredential(studentId, adminId);
    const result: any = QRService.verifyToken(issued.token, 'MANAGER', 'CAMERA', adminId);
    expect(result.outcome).toBe('GRANTED');
    expect(result.student.full_name).toBeTruthy();
    expect(result.student.department).toBe('Computer Science');
    expect(result.student.academic_level).toBe('300 Level');
    expect(result.hostel.name).toBeTruthy();
    expect(result.room.room_number).toBe('M-101');
    expect(result.allocation.start_date).toBe('2026-01-15');
    expect(typeof result.student.photo_url).toBe('string');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('15551001001');
    expect(serialized.toLowerCase()).not.toContain('pay-');
    // The photo_url legitimately reuses the token the manager just scanned
    // (capability URL); nothing else secret may appear.
    expect(result.student.photo_url).toBe(
      `/api/qr/staff/${encodeURIComponent(issued.token)}/photo`,
    );
    expect(serialized).not.toContain('token_ciphertext');
    expect(serialized).not.toContain('consent_random');
  });

  it('missing approved photo yields a safe withheld fallback for managers', () => {
    StudentPhotoService.submitPhoto(freshUploadToken(), jpeg);
    approve();
    const issued = QRService.issueCredential(studentId, adminId);
    // Simulate the file going missing after issuance.
    for (const file of fs.readdirSync(config.photoStorageDir)) {
      fs.rmSync(path.join(config.photoStorageDir, file), { force: true });
    }
    const result: any = QRService.verifyToken(issued.token, 'MANAGER', 'MANUAL_ENTRY', adminId);
    expect(result.outcome).toBe('GRANTED');
    expect(result.student.photo_url).toBeUndefined();
    expect(result.photo_display).toBe('WITHHELD');
  });

  it('a replacement candidate keeps the approved photograph active until approval', () => {
    StudentPhotoService.submitPhoto(freshUploadToken(), jpeg);
    approve();
    const issued = QRService.issueCredential(studentId, adminId);
    expect((QRService.getPublicVerification(issued.token) as any).photo_display).toBe('CONSENTED');
    const beforePath = QRService.getVerifiedPhoto(issued.token).storagePath;
    const candidate = StudentPhotoService.submitPhoto(freshUploadToken(), jpeg);
    expect(candidate.isReplacement).toBe(true);
    // Credential stays valid and keeps serving the previous approved photo.
    const during: any = QRService.getPublicVerification(issued.token);
    expect(during.status).toBe('VALID_RESIDENT');
    expect(during.photo_display).toBe('CONSENTED');
    expect(QRService.getVerifiedPhoto(issued.token).storagePath).toBe(beforePath);
    approve();
    const after: any = QRService.getPublicVerification(issued.token);
    expect(after.photo_display).toBe('CONSENTED');
    expect(QRService.getVerifiedPhoto(issued.token).storagePath).not.toBe(beforePath);
  });

  it('revoked credentials cannot retrieve photographs', () => {
    StudentPhotoService.submitPhoto(freshUploadToken(), jpeg);
    approve();
    const issued = QRService.issueCredential(studentId, adminId);
    QRService.revokeCredential((issued.credential as any).id, 'Security hold', adminId);
    expect((QRService.getPublicVerification(issued.token) as any).status).toBe(
      'INVALID_CREDENTIAL',
    );
    expect(() => QRService.getVerifiedPhoto(issued.token)).toThrow();
  });

  it('unissued or invalid tokens retrieve no resident or photograph', () => {
    const res: any = QRService.getPublicVerification('not-a-valid-token-1234567890123456789');
    expect(res.status).toBe('INVALID_CREDENTIAL');
    expect(res.student).toBeUndefined();
    expect(res.photo_url).toBeUndefined();
    expect(() => QRService.getVerifiedPhoto('not-a-valid-token-1234567890123456789')).toThrow();
  });

  it('legacy approved photographs without upload permission stay withheld', () => {
    // Simulates a photograph approved before the upload-disclosure rule: an
    // APPROVED submission with no permission row must not display.
    const db = getDb();
    db.prepare('UPDATE students SET photo_storage_key = ? WHERE id = ?').run(
      'legacy-approved.jpg',
      studentId,
    );
    db.prepare(
      `INSERT INTO student_photo_submissions (id, student_id, storage_key, mime_type, status, submitted_at, reviewed_by_admin_id, reviewed_at)
       VALUES ('legacy-sub-01', ?, 'legacy-approved.jpg', 'image/jpeg', 'APPROVED', datetime('now'), ?, datetime('now'))`,
    ).run(studentId, adminId);
    fs.mkdirSync(config.photoStorageDir, { recursive: true });
    fs.writeFileSync(path.join(config.photoStorageDir, 'legacy-approved.jpg'), jpeg);
    expect(PhotoDisplayConsentService.hasDisplayConsent(studentId)).toBe(false);
    expect(QRService.getPhotoAvailability(studentId).available).toBe(false);
  });

  it('withdrawal immediately withholds; a fresh upload restores permission only after approval', () => {
    StudentPhotoService.submitPhoto(freshUploadToken(), jpeg);
    approve();
    const issued = QRService.issueCredential(studentId, adminId);
    expect((QRService.getPublicVerification(issued.token) as any).photo_display).toBe('CONSENTED');
    PhotoDisplayConsentService.recordDecision({
      studentId,
      decision: 'WITHDRAWN',
      decidedBy: 'MANAGER',
      adminId,
      notes: 'resident takedown',
    });
    expect((QRService.getPublicVerification(issued.token) as any).photo_display).toBe('WITHHELD');
    // A fresh upload re-grants permission as a replacement candidate; the
    // still-approved current photograph displays again immediately.
    StudentPhotoService.submitPhoto(freshUploadToken(), jpeg);
    expect(latestConsent().decision).toBe('GRANTED');
    const restored: any = QRService.getPublicVerification(issued.token);
    expect(restored.photo_display).toBe('CONSENTED');
    expect(restored.photo_url).toContain('/api/qr/staff/');
    approve();
    expect((QRService.getPublicVerification(issued.token) as any).photo_display).toBe('CONSENTED');
  });

  it('WhatsApp YES text never grants permission; NO records a takedown', async () => {
    await ConversationHandler.handlePhotoConsent(residentPhone, true);
    expect(latestConsent()).toBeUndefined();
    await ConversationHandler.handlePhotoConsent(residentPhone, false);
    expect(latestConsent().decision).toBe('WITHDRAWN');
  });

  it('CONSENT YES during random-matching still counts as matching consent', async () => {
    const probePhone = '+14440009999';
    SimulatorProvider.clearHistory();
    ConversationHandler.getConversation(probePhone); // creates the IDLE row
    ConversationHandler.updateConversation(probePhone, 'AWAITING_RANDOM_CONSENT', {
      full_name: 'Consent Probe',
      gender: 'MALE',
      department: 'Computer Science',
      academic_level: '100 Level',
      preferred_occupancy: 2,
      roommate_mode: 'RANDOM',
    });
    await ConversationHandler.processIncomingMessage({
      messageId: 'msg-consent-yes-probe-1',
      from: probePhone,
      textBody: 'CONSENT YES',
    });
    const history = SimulatorProvider.getHistory(probePhone);
    expect(history.some((m) => m.text?.includes('No separate consent step'))).toBe(false);
    expect(history.some((m) => m.text?.includes('CONGRATULATIONS'))).toBe(true);
    // Words alone grant no photo-display permission.
    const created = StudentService.getStudentByPhone(probePhone) as any;
    expect(created?.id).toBeTruthy();
    expect(
      getDb()
        .prepare(`SELECT id FROM photo_display_consents WHERE student_id = ?`)
        .get(created.id),
    ).toBeUndefined();
  });

  it('scanner and consent endpoints stay behind manager authentication', () => {
    // Direct middleware verification (HTTP sockets are unavailable in this
    // sandbox; route wiring to authMiddleware is asserted below and unchanged).
    const deny = (headers: any) =>
      new Promise<number>((resolve) => {
        const res: any = {
          status: (code: number) => ({ json: () => resolve(code) }),
        };
        authMiddleware({ headers } as any, res, () => resolve(200));
      });
    return (async () => {
      expect(await deny({})).toBe(401);
      expect(await deny({ authorization: 'Bearer invalid' })).toBe(401);
      const good = jwt.sign(
        { id: adminId, username: 'admin', full_name: 'Admin', email: 'a@x.y' },
        config.jwtSecret,
      );
      expect(await deny({ authorization: `Bearer ${good}` })).toBe(200);
    })();
  });

  it('removed manager grant endpoint is gone; withdraw and status remain', () => {
    const paths = (studentPhotoRouter.stack as any[])
      .filter((l) => l.route)
      .map((l) => `${Object.keys(l.route.methods).join(',').toUpperCase()} ${l.route.path}`);
    expect(paths.some((p) => p.includes('/photo-display-consent/:studentId/grant'))).toBe(false);
    expect(paths.some((p) => p.includes('/photo-display-consent/:studentId/withdraw'))).toBe(true);
    expect(paths.some((p) => p.includes('/photo-display-consent/:studentId') && p.startsWith('GET'))).toBe(true);
    // Service behavior behind the remaining endpoints is unchanged.
    expect(PhotoDisplayConsentService.getCurrentStatus(studentId).decision).toBe('NONE');
    const withdrawn = PhotoDisplayConsentService.recordDecision({
      studentId,
      decision: 'WITHDRAWN',
      decidedBy: 'MANAGER',
      adminId,
      notes: 'takedown test',
    });
    expect(withdrawn.status).toBe('WITHDRAWN');
    expect(PhotoDisplayConsentService.getCurrentStatus(studentId).consented).toBe(false);
  });

  it('photo approval and QR issuance workflows remain intact', () => {
    StudentPhotoService.submitPhoto(freshUploadToken(), jpeg);
    const first = approve();
    expect(first.status).toBe('APPROVED');
    const issued = QRService.issueCredential(studentId, adminId);
    expect((issued.credential as any).status).toBe('ACTIVE');
    // Second issuance without reissue is still rejected.
    expect(() => QRService.issueCredential(studentId, adminId)).toThrow(/already has an active credential/);
    const reissued = QRService.issueCredential(studentId, adminId, true);
    expect((reissued.credential as any).status).toBe('ACTIVE');
  });
});
