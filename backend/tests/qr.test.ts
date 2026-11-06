import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getDb } from '../src/db/connection.js';
import { runSeed } from '../src/db/seed.js';
import { QRService } from '../src/services/qrService.js';
import { config } from '../src/config.js';

const studentId = 'stu-demo-01';
const adminId = 'admin-root-01';

async function approveCurrentPhoto() {
  const db = getDb();
  db.prepare("UPDATE students SET photo_storage_key = 'qr-test-photo.jpg' WHERE id = ?").run(studentId);
  db.prepare(`INSERT INTO student_photo_submissions (id, student_id, storage_key, mime_type, status, submitted_at, reviewed_by_admin_id, reviewed_at)
    VALUES ('qr-test-photo', ?, 'qr-test-photo.jpg', 'image/jpeg', 'APPROVED', datetime('now'), ?, datetime('now'))`).run(studentId, adminId);
}

describe('resident QR credentials', () => {
  beforeEach(async () => { await runSeed(true); });

  it('requires a current approved photograph before manager issuance', () => {
    expect(() => QRService.issueCredential(studentId, adminId)).toThrow('approved current photograph');
  });

  it('stores only a SHA-256 hash, verifies an opaque URL, and logs the public verification', async () => {
    await approveCurrentPhoto();
    const issued = QRService.issueCredential(studentId, adminId);
    expect(issued.token).toHaveLength(43);
    expect(issued.verificationUrl).toContain('/resident-verification/');
    const stored = getDb().prepare('SELECT * FROM resident_qr_credentials WHERE id = ?').get((issued.credential as any).id) as any;
    expect(stored.token_hash).toBe(QRService.hashToken(issued.token));
    expect(JSON.stringify(stored)).not.toContain(issued.token);
    const result = QRService.getPublicVerification(issued.token);
    expect(result.status).toBe('VALID_RESIDENT');
    expect(result.student.full_name).toContain('John Doe');
    expect(getDb().prepare("SELECT outcome FROM access_logs WHERE resident_qr_credential_id = ? ORDER BY logged_at DESC LIMIT 1").get(stored.id)).toEqual({ outcome: 'GRANTED' });
  });

  it('reissues by revoking the prior credential and records the lineage and audit record', async () => {
    await approveCurrentPhoto();
    const first = QRService.issueCredential(studentId, adminId);
    const second = QRService.issueCredential(studentId, adminId, true);
    const old = getDb().prepare('SELECT * FROM resident_qr_credentials WHERE id = ?').get((first.credential as any).id) as any;
    const replacement = getDb().prepare('SELECT * FROM resident_qr_credentials WHERE id = ?').get((second.credential as any).id) as any;
    expect(old.status).toBe('REVOKED');
    expect(replacement.reissued_from_credential_id).toBe(old.id);
    expect(QRService.getPublicVerification(first.token).status).toBe('INVALID_CREDENTIAL');
    expect(QRService.getPublicVerification(second.token).status).toBe('VALID_RESIDENT');
    expect(getDb().prepare("SELECT id FROM audit_logs WHERE action = 'REISSUE_RESIDENT_QR_CREDENTIAL' AND entity_id = ?").get(replacement.id)).toBeTruthy();
  });

  it('uses the current finalized allocation rather than the allocation used at issuance', async () => {
    await approveCurrentPhoto();
    const issued = QRService.issueCredential(studentId, adminId);
    getDb().prepare("UPDATE room_allocations SET room_id = 'rm-m-104' WHERE id = 'alloc-demo-01'").run();
    const result = QRService.getPublicVerification(issued.token);
    expect(result.status).toBe('VALID_RESIDENT');
    expect(result.room.room_number).toBe('M-104');
  });

  it('delivers an approved photograph only while the credential remains valid', async () => {
    await approveCurrentPhoto();
    fs.mkdirSync(config.photoStorageDir, { recursive: true });
    fs.writeFileSync(path.join(config.photoStorageDir, 'qr-test-photo.jpg'), Buffer.from('test-photo'));
    const issued = QRService.issueCredential(studentId, adminId);
    expect(QRService.getVerifiedPhoto(issued.token).mimeType).toBe('image/jpeg');
    QRService.revokeCredential((issued.credential as any).id, 'Security hold', adminId);
    expect(() => QRService.getVerifiedPhoto(issued.token)).toThrow('Credential is not valid');
  });

  it('denies revoked, invalid, payment-ineligible, future, and expired credentials', async () => {
    await approveCurrentPhoto();
    const issued = QRService.issueCredential(studentId, adminId);
    expect(QRService.revokeCredential((issued.credential as any).id, 'Security hold', adminId)).toBe(true);
    expect(QRService.getPublicVerification(issued.token).status).toBe('INVALID_CREDENTIAL');
    expect(QRService.getPublicVerification('not-a-valid-credential').status).toBe('INVALID_CREDENTIAL');
    const next = QRService.issueCredential(studentId, adminId, true);
    getDb().prepare("UPDATE payments SET status = 'PENDING' WHERE student_id = ? AND booking_group_id = 'grp-demo-01'").run(studentId);
    expect(QRService.getPublicVerification(next.token).status).toBe('INVALID_CREDENTIAL');
    getDb().prepare("UPDATE payments SET status = 'VERIFIED' WHERE student_id = ? AND booking_group_id = 'grp-demo-01'").run(studentId);
    getDb().prepare("UPDATE room_allocations SET accommodation_start_date = '2999-01-01' WHERE id = 'alloc-demo-01'").run();
    expect(QRService.getPublicVerification(next.token).status).toBe('INVALID_CREDENTIAL');
    getDb().prepare("UPDATE room_allocations SET accommodation_start_date = '2000-01-01', accommodation_end_date = '2000-01-02' WHERE id = 'alloc-demo-01'").run();
    expect(QRService.getPublicVerification(next.token).status).toBe('INVALID_CREDENTIAL');
    expect(getDb().prepare('SELECT status FROM resident_qr_credentials WHERE id = ?').get((next.credential as any).id)).toEqual({ status: 'EXPIRED' });
  });
});
