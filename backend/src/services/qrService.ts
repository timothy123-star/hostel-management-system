import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { getDb } from '../db/connection.js';
import { config } from '../config.js';
import { AuditService } from './auditService.js';

type Channel = 'MANAGER' | 'PUBLIC_BROWSER';
type Method = 'CAMERA' | 'MANUAL_ENTRY';

/** Individual, manager-authorized resident credentials. Raw tokens exist only
 * while a newly issued QR is being returned to the manager. */
export class QRService {
  static generateToken() {
    const token = crypto.randomBytes(32).toString('base64url');
    return { token, tokenHash: this.hashToken(token) };
  }

  static hashToken(token: string) {
    return crypto.createHash('sha256').update(this.extractToken(token)).digest('hex');
  }

  static verificationUrl(token: string) {
    return `${config.publicAppUrl}/resident-verification/${encodeURIComponent(token)}`;
  }

  private static extractToken(raw: string) {
    const trimmed = raw.trim();
    const match = trimmed.match(/\/resident-verification\/([A-Za-z0-9_-]{43})\/?$/);
    return match ? match[1] : trimmed;
  }

  static async generateQRImage(token: string) {
    return QRCode.toDataURL(this.verificationUrl(token), {
      errorCorrectionLevel: 'H', margin: 2, width: 400,
      color: { dark: '#0f172a', light: '#ffffff' }
    });
  }

  static issueCredential(studentId: string, adminId: string, reissue = false) {
    if (!adminId) throw new Error('A manager identity is required to issue a credential.');
    const db = getDb();
    const eligibility = this.getEligibility(studentId);
    if (!eligibility.eligible) throw new Error(eligibility.reason);
    const active = db.prepare("SELECT * FROM resident_qr_credentials WHERE student_id = ? AND status = 'ACTIVE'").get(studentId) as any;
    if (active && !reissue) throw new Error('This student already has an active credential. Use reissue to revoke and replace it.');

    const { token, tokenHash } = this.generateToken();
    const id = `resident-qr-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    db.transaction(() => {
      if (active) {
        db.prepare(`UPDATE resident_qr_credentials SET status = 'REVOKED', revoked_at = ?, revoked_by_admin_id = ?,
          revoke_reason = 'Reissued by manager', updated_at = ? WHERE id = ? AND status = 'ACTIVE'`)
          .run(now, adminId, now, active.id);
      }
      db.prepare(`INSERT INTO resident_qr_credentials
        (id, student_id, issued_for_allocation_id, token_hash, status, issued_by_admin_id, issued_at, reissued_from_credential_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)`)
        .run(id, studentId, eligibility.allocation.id, tokenHash, adminId, now, active?.id || null, now, now);
    })();
    AuditService.log({ adminId, action: reissue ? 'REISSUE_RESIDENT_QR_CREDENTIAL' : 'ISSUE_RESIDENT_QR_CREDENTIAL',
      entityType: 'RESIDENT_QR_CREDENTIAL', entityId: id,
      oldValues: active ? { credential_id: active.id, status: 'ACTIVE' } : undefined,
      newValues: { student_id: studentId, allocation_id: eligibility.allocation.id },
      notes: reissue ? 'Previous credential revoked and replaced.' : 'Manager-authorized resident credential issued.' });
    return { credential: db.prepare('SELECT * FROM resident_qr_credentials WHERE id = ?').get(id), token,
      verificationUrl: this.verificationUrl(token), allocation: eligibility.allocation };
  }

  static revokeCredential(credentialId: string, reason: string, adminId: string) {
    if (!adminId) throw new Error('A manager identity is required to revoke a credential.');
    const db = getDb(); const existing = db.prepare('SELECT * FROM resident_qr_credentials WHERE id = ?').get(credentialId) as any;
    if (!existing) return false;
    if (existing.status !== 'ACTIVE') throw new Error('Only an active credential can be revoked.');
    const now = new Date().toISOString();
    const result = db.prepare(`UPDATE resident_qr_credentials SET status = 'REVOKED', revoked_at = ?, revoked_by_admin_id = ?,
      revoke_reason = ?, updated_at = ? WHERE id = ? AND status = 'ACTIVE'`).run(now, adminId, reason.trim(), now, credentialId);
    if (result.changes) AuditService.log({ adminId, action: 'REVOKE_RESIDENT_QR_CREDENTIAL', entityType: 'RESIDENT_QR_CREDENTIAL', entityId: credentialId,
      oldValues: { status: 'ACTIVE' }, newValues: { status: 'REVOKED', reason: reason.trim() }, notes: 'Manager revoked resident credential.' });
    return result.changes > 0;
  }

  static async getQRForExistingCredential(studentId: string) {
    // The raw token is intentionally not persisted, so WhatsApp must never regenerate or issue a pass.
    const credential = getDb().prepare("SELECT id FROM resident_qr_credentials WHERE student_id = ? AND status = 'ACTIVE'").get(studentId);
    return credential || null;
  }

  static verifyToken(rawToken: string, channel: Channel, method: Method = 'MANUAL_ENTRY', adminId?: string) {
    const tokenHash = this.hashToken(rawToken);
    const db = getDb();
    const credential = db.prepare(`SELECT c.*, s.full_name, s.id as student_id
      FROM resident_qr_credentials c JOIN students s ON s.id = c.student_id WHERE c.token_hash = ?`).get(tokenHash) as any;
    if (!credential) return this.logAndDeny(null, null, channel, method, adminId, 'Invalid or unrecognised credential.');
    if (credential.status !== 'ACTIVE') return this.logAndDeny(credential.id, credential.student_id, channel, method, adminId, 'Credential is not active.');
    const eligibility = this.getEligibility(credential.student_id);
    if (!eligibility.eligible) {
      if (eligibility.expired) db.prepare("UPDATE resident_qr_credentials SET status = 'EXPIRED', updated_at = ? WHERE id = ? AND status = 'ACTIVE'").run(new Date().toISOString(), credential.id);
      return this.logAndDeny(credential.id, credential.student_id, channel, method, adminId, eligibility.reason);
    }
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare('UPDATE resident_qr_credentials SET last_verified_at = ?, updated_at = ? WHERE id = ?').run(now, now, credential.id);
      this.insertAccessLog(credential.id, credential.student_id, channel, method, adminId, 'GRANTED', 'Valid resident credential.');
    })();
    const allocation = eligibility.allocation;
    return { outcome: 'GRANTED', reason: 'Valid resident credential.', student: { id: credential.student_id, full_name: credential.full_name },
      room: { room_number: allocation.room_number }, hostel: { name: allocation.hostel_name, code: allocation.hostel_code },
      allocation: { start_date: allocation.accommodation_start_date, end_date: allocation.accommodation_end_date },
      credential: { id: credential.id, status: 'ACTIVE', issued_at: credential.issued_at } };
  }

  static getVerifiedPhoto(rawToken: string) {
    const result = this.verifyToken(rawToken, 'PUBLIC_BROWSER');
    const verified = result as any;
    if (verified.outcome !== 'GRANTED' || !verified.student) throw new Error('Credential is not valid.');
    const photo = getDb().prepare(`SELECT ps.storage_key, ps.mime_type FROM students s
      JOIN student_photo_submissions ps ON ps.storage_key = s.photo_storage_key
      WHERE s.id = ? AND ps.status = 'APPROVED'`).get(verified.student.id) as any;
    if (!photo) throw new Error('Credential is not valid.');
    const storagePath = path.resolve(config.photoStorageDir, photo.storage_key);
    if (path.dirname(storagePath) !== path.resolve(config.photoStorageDir) || !fs.existsSync(storagePath)) throw new Error('Credential is not valid.');
    return { storagePath, mimeType: photo.mime_type };
  }

  static getPublicVerification(rawToken: string) {
    const result = this.verifyToken(rawToken, 'PUBLIC_BROWSER');
    if (result.outcome !== 'GRANTED') return { status: 'INVALID_CREDENTIAL', reason: result.reason };
    return { status: 'VALID_RESIDENT', ...result, photo_url: `/api/qr/public/${encodeURIComponent(rawToken)}/photo` };
  }

  static getCredentials() {
    return getDb().prepare(`SELECT c.*, s.full_name as student_name, s.phone_number, r.room_number, h.code as hostel_code, h.name as hostel_name,
      issuer.full_name as issued_by_name, revoker.full_name as revoked_by_name
      FROM resident_qr_credentials c JOIN students s ON s.id = c.student_id
      LEFT JOIN room_allocations ra ON ra.student_id = c.student_id AND ra.status = 'FINALIZED'
      LEFT JOIN rooms r ON r.id = ra.room_id LEFT JOIN hostels h ON h.id = r.hostel_id
      JOIN admin_users issuer ON issuer.id = c.issued_by_admin_id LEFT JOIN admin_users revoker ON revoker.id = c.revoked_by_admin_id
      ORDER BY c.issued_at DESC`).all();
  }

  static getAccessLogs() {
    return getDb().prepare(`SELECT al.*, s.full_name as student_name, s.phone_number as student_phone, au.username as verified_by_username
      FROM access_logs al LEFT JOIN students s ON s.id = al.student_id LEFT JOIN admin_users au ON au.id = al.verified_by_admin_id
      WHERE al.resident_qr_credential_id IS NOT NULL OR al.verification_channel = 'PUBLIC_BROWSER'
      ORDER BY al.logged_at DESC LIMIT 100`).all();
  }

  private static getEligibility(studentId: string): { eligible: boolean; reason: string; expired?: boolean; allocation?: any } {
    const allocation = getDb().prepare(`SELECT ra.*, r.room_number, h.code as hostel_code, h.name as hostel_name
      FROM room_allocations ra JOIN rooms r ON r.id = ra.room_id JOIN hostels h ON h.id = r.hostel_id
      WHERE ra.student_id = ? AND ra.status = 'FINALIZED' ORDER BY ra.updated_at DESC LIMIT 1`).get(studentId) as any;
    if (!allocation) return { eligible: false, reason: 'No current finalized accommodation.' };
    const today = new Date().toISOString().slice(0, 10);
    if (allocation.accommodation_start_date > today) return { eligible: false, reason: 'Accommodation has not started.', allocation };
    if (allocation.accommodation_end_date < today) return { eligible: false, reason: 'Accommodation has expired.', expired: true, allocation };
    const payment = getDb().prepare("SELECT id FROM payments WHERE student_id = ? AND booking_group_id = ? AND status = 'VERIFIED'").get(studentId, allocation.booking_group_id);
    if (!payment) return { eligible: false, reason: 'Verified payment for the current booking is required.', allocation };
    const photo = getDb().prepare(`SELECT ps.id FROM students s JOIN student_photo_submissions ps ON ps.storage_key = s.photo_storage_key
      WHERE s.id = ? AND ps.status = 'APPROVED'`).get(studentId);
    if (!photo) return { eligible: false, reason: 'An approved current photograph is required.', allocation };
    return { eligible: true, reason: '', allocation };
  }

  private static logAndDeny(credentialId: string | null, studentId: string | null, channel: Channel, method: Method, adminId: string | undefined, reason: string) {
    this.insertAccessLog(credentialId, studentId, channel, method, adminId, 'DENIED', reason);
    return { outcome: 'DENIED', reason };
  }

  private static insertAccessLog(credentialId: string | null, studentId: string | null, channel: Channel, method: Method, adminId: string | undefined, outcome: 'GRANTED' | 'DENIED', reason: string) {
    getDb().prepare(`INSERT INTO access_logs (id, resident_qr_credential_id, student_id, verified_by_admin_id, verification_method, verification_channel, outcome, reason, logged_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`).run(`acc-${crypto.randomUUID()}`, credentialId, studentId, adminId || null, method, channel, outcome, reason);
  }
}
