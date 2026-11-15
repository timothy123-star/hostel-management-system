import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import { runSeed } from '../src/db/seed.js';
import { getDb } from '../src/db/connection.js';
import { config } from '../src/config.js';
import { QRService } from '../src/services/qrService.js';
import { StudentPhotoService } from '../src/services/studentPhotoService.js';
import { PHOTO_UPLOAD_DISCLOSURE_VERSION, PhotoDisplayConsentService } from '../src/services/photoDisplayConsentService.js';

const adminId = 'admin-root-01';
const studentId = 'stu-demo-01';

const jpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0x01,
  0x11, 0x00, 0xff, 0xd9,
]);

function uploadLink() {
  return StudentPhotoService.issueUploadLink(studentId, adminId).uploadUrl.split('/').pop()!;
}

function pointer() {
  return (getDb().prepare('SELECT photo_storage_key FROM students WHERE id = ?').get(studentId) as any)?.photo_storage_key as string;
}

function submissions() {
  return getDb().prepare('SELECT id, storage_key, status FROM student_photo_submissions WHERE student_id = ? ORDER BY submitted_at ASC').all(studentId) as any[];
}

describe('replacement photograph continuity', () => {
  beforeEach(async () => {
    await runSeed(true);
    fs.rmSync(config.photoStorageDir, { recursive: true, force: true });
  });

  it('a replacement candidate leaves the active pointer and eligibility untouched', () => {
    StudentPhotoService.submitPhoto(uploadLink(), jpeg);
    StudentPhotoService.reviewPhoto(studentId, 'APPROVED', adminId);
    const active = pointer();
    expect(active).toBeTruthy();
    const issued = QRService.issueCredential(studentId, adminId);

    const candidate = StudentPhotoService.submitPhoto(uploadLink(), jpeg);
    expect(candidate.isReplacement).toBe(true);
    expect(pointer()).toBe(active);
    const rows = submissions();
    expect(rows.filter((r) => r.status === 'APPROVED')).toHaveLength(1);
    expect(rows.filter((r) => r.status === 'PENDING_REVIEW')).toHaveLength(1);
    // Credential stays valid and keeps serving the previous approved photo.
    expect((QRService.getPublicVerification(issued.token, 'MANAGER', adminId) as any).status).toBe('VALID_RESIDENT');
    expect(QRService.getVerifiedPhoto(issued.token, 'MANAGER', adminId).storagePath).toContain(active);
  });

  it('approving a replacement atomically switches the active photograph', () => {
    StudentPhotoService.submitPhoto(uploadLink(), jpeg);
    StudentPhotoService.reviewPhoto(studentId, 'APPROVED', adminId);
    const before = pointer();
    const issued = QRService.issueCredential(studentId, adminId);

    StudentPhotoService.submitPhoto(uploadLink(), jpeg);
    const review = StudentPhotoService.reviewPhoto(studentId, 'APPROVED', adminId);
    expect(review.isReplacement).toBe(true);
    const after = pointer();
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);
    expect((QRService.getPublicVerification(issued.token, 'MANAGER', adminId) as any).photo_display).toBe('CONSENTED');
    expect(QRService.getVerifiedPhoto(issued.token, 'MANAGER', adminId).storagePath).toContain(after);
    // History is preserved: the superseded row stays APPROVED but inactive.
    const rows = submissions();
    expect(rows.filter((r) => r.status === 'APPROVED')).toHaveLength(2);
  });

  it('explicit submission targeting approves the chosen candidate', () => {
    StudentPhotoService.submitPhoto(uploadLink(), jpeg);
    StudentPhotoService.reviewPhoto(studentId, 'APPROVED', adminId);
    const first = StudentPhotoService.submitPhoto(uploadLink(), jpeg);
    void first;
    const second = StudentPhotoService.submitPhoto(uploadLink(), jpeg);
    const pending = submissions().filter((r) => r.status === 'PENDING_REVIEW');
    expect(pending).toHaveLength(2);
    const chosen = pending[0];
    const review = StudentPhotoService.reviewPhoto(studentId, 'APPROVED', adminId, undefined, chosen.id);
    expect(review.submissionId).toBe(chosen.id);
    expect(pointer()).toBe(chosen.storage_key);
    expect(second.isReplacement).toBe(true);
  });

  it('rejecting a replacement preserves the previous approved photograph', () => {
    StudentPhotoService.submitPhoto(uploadLink(), jpeg);
    StudentPhotoService.reviewPhoto(studentId, 'APPROVED', adminId);
    const active = pointer();
    const issued = QRService.issueCredential(studentId, adminId);

    StudentPhotoService.submitPhoto(uploadLink(), jpeg);
    const review = StudentPhotoService.reviewPhoto(studentId, 'REJECTED', adminId, 'Too blurry');
    expect(review.isReplacement).toBe(true);
    expect(pointer()).toBe(active);
    const valid: any = QRService.getPublicVerification(issued.token, 'MANAGER', adminId);
    expect(valid.status).toBe('VALID_RESIDENT');
    expect(valid.photo_display).toBe('CONSENTED');
    expect(QRService.getVerifiedPhoto(issued.token, 'MANAGER', adminId).storagePath).toContain(active);
  });

  it('repeated approval cannot leave two active approved photographs', () => {
    StudentPhotoService.submitPhoto(uploadLink(), jpeg);
    StudentPhotoService.reviewPhoto(studentId, 'APPROVED', adminId);
    StudentPhotoService.submitPhoto(uploadLink(), jpeg);
    StudentPhotoService.reviewPhoto(studentId, 'APPROVED', adminId);
    expect(() => StudentPhotoService.reviewPhoto(studentId, 'APPROVED', adminId)).toThrow(/pending/i);
    const activeCount = (getDb().prepare(
      `SELECT count(*) c FROM students s JOIN student_photo_submissions ps ON ps.storage_key = s.photo_storage_key WHERE s.id = ? AND ps.status = 'APPROVED'`
    ).get(studentId) as any).c;
    expect(activeCount).toBe(1);
  });

  it('removal via withdrawal prevents display while history remains', () => {
    StudentPhotoService.submitPhoto(uploadLink(), jpeg);
    StudentPhotoService.reviewPhoto(studentId, 'APPROVED', adminId);
    const issued = QRService.issueCredential(studentId, adminId);
    expect((QRService.getPublicVerification(issued.token, 'MANAGER', adminId) as any).photo_display).toBe('CONSENTED');
    PhotoDisplayConsentService.recordDecision({ studentId, decision: 'WITHDRAWN', decidedBy: 'MANAGER', adminId, notes: 'removal' });
    expect((QRService.getPublicVerification(issued.token, 'MANAGER', adminId) as any).photo_url).toBeUndefined();
    expect(StudentPhotoService.getReviewHistory(studentId).length).toBeGreaterThan(0);
  });

  it('initial approval and explicit QR issuance requirements remain intact', () => {
    const first = StudentPhotoService.submitPhoto(uploadLink(), jpeg);
    expect(first.isReplacement).toBe(false);
    expect(() => QRService.issueCredential(studentId, adminId)).toThrow(/approved current photograph/i);
    StudentPhotoService.reviewPhoto(studentId, 'APPROVED', adminId);
    const issued = QRService.issueCredential(studentId, adminId);
    expect((issued.credential as any).status).toBe('ACTIVE');
    expect(() => QRService.issueCredential(studentId, adminId)).toThrow(/already has an active credential/);
  });

  it('WhatsApp uploads follow the same replacement rule', () => {
    StudentPhotoService.submitWhatsAppPhoto(studentId, jpeg, { messageId: 'w1', phoneNumber: '+x' }, { disclosureVersion: PHOTO_UPLOAD_DISCLOSURE_VERSION });
    StudentPhotoService.reviewPhoto(studentId, 'APPROVED', adminId);
    const active = pointer();
    const res = StudentPhotoService.submitWhatsAppPhoto(studentId, jpeg, { messageId: 'w2', phoneNumber: '+x' }, { disclosureVersion: PHOTO_UPLOAD_DISCLOSURE_VERSION });
    expect(res.isReplacement).toBe(true);
    expect(pointer()).toBe(active);
  });
});
