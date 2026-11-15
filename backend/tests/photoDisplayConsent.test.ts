import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { runSeed } from '../src/db/seed.js';
import { getDb } from '../src/db/connection.js';
import { QRService } from '../src/services/qrService.js';
import { PhotoDisplayConsentService } from '../src/services/photoDisplayConsentService.js';
import { config } from '../src/config.js';

const adminId = 'admin-root-01';

function setupStudent(opts: { studentId: string; storageKey: string; photoStatus: 'APPROVED' | 'PENDING_REVIEW' | 'REJECTED'; consent?: 'GRANTED' | 'DECLINED' | 'WITHDRAWN' | 'NONE' }) {
  const db = getDb();
  db.prepare('DELETE FROM resident_qr_credentials WHERE student_id = ?').run(opts.studentId);
  db.prepare('DELETE FROM photo_display_consents WHERE student_id = ?').run(opts.studentId);
  db.prepare('DELETE FROM student_photo_submissions WHERE student_id = ?').run(opts.studentId);
  db.prepare('UPDATE students SET photo_storage_key = ? WHERE id = ?').run(opts.storageKey, opts.studentId);
  const subId = `sub-${opts.studentId}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  db.prepare(`INSERT INTO student_photo_submissions (id, student_id, storage_key, mime_type, status, submitted_at) VALUES (?, ?, ?, 'image/jpeg', ?, datetime('now'))`)
    .run(subId, opts.studentId, opts.storageKey, opts.photoStatus);
  fs.mkdirSync(config.photoStorageDir, { recursive: true });
  fs.writeFileSync(path.join(config.photoStorageDir, opts.storageKey), Buffer.from('fake-image-bytes'));
  if (opts.consent && opts.consent !== 'NONE') {
    PhotoDisplayConsentService.recordDecision({ studentId: opts.studentId, decision: opts.consent, decidedBy: 'MANAGER', adminId, notes: 'test consent' });
  }
  return { subId };
}

describe('QR photo display consent', () => {
  beforeAll(async () => { await runSeed(true); }, 60000);
  beforeEach(() => {
    // keep seed; per-test fixtures use distinct storage keys
  });

  it('active + approved + consent: photograph displayed', () => {
    setupStudent({ studentId: 'stu-demo-01', storageKey: 'consent-a.jpg', photoStatus: 'APPROVED', consent: 'GRANTED' });
    const issued = QRService.issueCredential('stu-demo-01', adminId);
    const pub: any = QRService.getPublicVerification(issued.token);
    expect(pub.status).toBe('VALID_RESIDENT');
    expect(pub.photo_display).toBe('CONSENTED');
    expect(typeof pub.photo_url).toBe('string');
    expect(QRService.getVerifiedPhoto(issued.token).storagePath.endsWith('consent-a.jpg')).toBe(true);
  });

  it('active + pending photo: withheld', () => {
    setupStudent({ studentId: 'stu-demo-02', storageKey: 'consent-pending.jpg', photoStatus: 'PENDING_REVIEW', consent: 'GRANTED' });
    // eligibility fails (photo not approved) so issue must fail; craft token path via direct availability check
    const avail = QRService.getPhotoAvailability('stu-demo-02');
    expect(avail.available).toBe(false);
  });

  it('active + rejected photo: withheld', () => {
    setupStudent({ studentId: 'stu-demo-02', storageKey: 'consent-rejected.jpg', photoStatus: 'REJECTED', consent: 'GRANTED' });
    expect(QRService.getPhotoAvailability('stu-demo-02').available).toBe(false);
  });

  it('active + no consent: withheld but verification still works', () => {
    setupStudent({ studentId: 'stu-demo-01', storageKey: 'consent-b.jpg', photoStatus: 'APPROVED', consent: 'NONE' });
    const issued = QRService.issueCredential('stu-demo-01', adminId);
    const pub: any = QRService.getPublicVerification(issued.token);
    expect(pub.status).toBe('VALID_RESIDENT');
    expect(pub.photo_display).toBe('WITHHELD');
    expect(pub.photo_url).toBeUndefined();
    expect(pub.student.full_name).toBeTruthy();
    expect(() => QRService.getVerifiedPhoto(issued.token)).toThrow();
  });

  it('withdrawn consent immediately blocks', () => {
    setupStudent({ studentId: 'stu-demo-01', storageKey: 'consent-c.jpg', photoStatus: 'APPROVED', consent: 'GRANTED' });
    const issued = QRService.issueCredential('stu-demo-01', adminId);
    expect((QRService.getPublicVerification(issued.token) as any).photo_url).toBeTruthy();
    PhotoDisplayConsentService.recordDecision({ studentId: 'stu-demo-01', decision: 'WITHDRAWN', decidedBy: 'MANAGER', adminId, notes: 'withdraw' });
    const after: any = QRService.getPublicVerification(issued.token);
    expect(after.photo_display).toBe('WITHHELD');
    expect(after.photo_url).toBeUndefined();
    expect(() => QRService.getVerifiedPhoto(issued.token)).toThrow();
  });

  it('expired or revoked: photo inaccessible', () => {
    setupStudent({ studentId: 'stu-demo-08', storageKey: 'consent-exp.jpg', photoStatus: 'APPROVED', consent: 'GRANTED' });
    // stu-demo-08 allocation expired 2026-11-09; issue should fail
    expect(() => QRService.issueCredential('stu-demo-08', adminId)).toThrow();
    setupStudent({ studentId: 'stu-demo-03', storageKey: 'consent-rev.jpg', photoStatus: 'APPROVED', consent: 'GRANTED' });
    const issued = QRService.issueCredential('stu-demo-03', adminId);
    QRService.revokeCredential((issued.credential as any).id, 'hold', adminId);
    expect((QRService.getPublicVerification(issued.token) as any).status).toBe('INVALID_CREDENTIAL');
    expect(() => QRService.getVerifiedPhoto(issued.token)).toThrow();
  });

  it('invalid token exposes nothing', () => {
    const res: any = QRService.getPublicVerification('not-a-valid-token-1234567890123456789');
    expect(res.status).toBe('INVALID_CREDENTIAL');
    expect(JSON.stringify(res)).not.toContain('stu-demo');
    expect(res.student).toBeUndefined();
  });

  it('replaced photograph: old inaccessible', () => {
    setupStudent({ studentId: 'stu-demo-01', storageKey: 'consent-old.jpg', photoStatus: 'APPROVED', consent: 'GRANTED' });
    const issued = QRService.issueCredential('stu-demo-01', adminId);
    const firstPath = QRService.getVerifiedPhoto(issued.token).storagePath;
    expect(firstPath.endsWith('consent-old.jpg')).toBe(true);
    // replace with new approved current photo
    const db = getDb();
    db.prepare('UPDATE students SET photo_storage_key = ? WHERE id = ?').run('consent-new.jpg', 'stu-demo-01');
    db.prepare(`INSERT INTO student_photo_submissions (id, student_id, storage_key, mime_type, status, submitted_at) VALUES (?, 'stu-demo-01', 'consent-new.jpg', 'image/jpeg', 'APPROVED', datetime('now'))`).run(`sub-new-${Date.now()}`);
    fs.writeFileSync(path.join(config.photoStorageDir, 'consent-new.jpg'), Buffer.from('new-bytes'));
    const secondPath = QRService.getVerifiedPhoto(issued.token).storagePath;
    expect(secondPath.endsWith('consent-new.jpg')).toBe(true);
    expect(secondPath).not.toBe(firstPath);
  });

  it('private metadata never exposed', () => {
    setupStudent({ studentId: 'stu-demo-01', storageKey: 'consent-priv.jpg', photoStatus: 'APPROVED', consent: 'GRANTED' });
    const issued = QRService.issueCredential('stu-demo-01', adminId);
    const pub: any = QRService.getPublicVerification(issued.token);
    const s = JSON.stringify(pub);
    expect(s).not.toContain('consent-priv.jpg');
    expect(s).not.toContain('phone');
    const { photo_url: _photoUrl, ...pubWithoutPhotoUrl } = pub;
    expect(JSON.stringify(pubWithoutPhotoUrl)).not.toContain(issued.token);
    expect(pub.photo_url).not.toContain('consent-priv.jpg');
    expect(pub.photo_url).toContain('/api/qr/staff/');
  });
});
