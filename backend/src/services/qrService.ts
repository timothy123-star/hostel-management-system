import crypto from 'crypto';
import QRCode from 'qrcode';
import { getDb } from '../db/connection.js';
import { QRCredential, AccessLog, VerificationMethod, AccessOutcome } from '@hostel/shared';

export class QRService {
  /**
   * Generates a cryptographic token and its SHA-256 hash.
   */
  static generateToken(): { token: string; tokenHash: string } {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    return { token, tokenHash };
  }

  /**
   * Hashes a raw token for database lookup.
   */
  static hashToken(token: string): string {
    const cleaned = token.trim().replace(/^HOSTEL-ID-PASS:/, '');
    return crypto.createHash('sha256').update(cleaned).digest('hex');
  }

  /**
   * Generates a QR Code image as a Data URL (base64 image/png).
   * QR payload contains ONLY the unpredictable token format.
   */
  static async generateQRImage(token: string): Promise<string> {
    const payload = `HOSTEL-ID-PASS:${token}`;
    return await QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 400,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });
  }

  /**
   * Issues or retrieves an existing QR credential for an allocated student.
   * Does NOT issue a new token every time if an active one already exists!
   */
  static async getOrIssueCredential(studentId: string, allocationId: string): Promise<{
    credential: any;
    token?: string; // only returned when newly minted
    qrImageData: string;
  }> {
    const db = getDb();

    // Check if an existing credential exists
    const existing = db.prepare(`
      SELECT * FROM qr_credentials 
      WHERE student_id = ? AND room_allocation_id = ?
    `).get(studentId, allocationId) as any;

    if (existing) {
      // If image is missing, regenerate it with token hash placeholder or update
      let image = existing.qr_image_data;
      if (!image) {
        image = await this.generateQRImage(existing.token_hash);
        db.prepare('UPDATE qr_credentials SET qr_image_data = ?, last_issued_at = datetime(\'now\') WHERE id = ?')
          .run(image, existing.id);
      } else {
        db.prepare('UPDATE qr_credentials SET last_issued_at = datetime(\'now\') WHERE id = ?')
          .run(existing.id);
      }
      return { credential: existing, qrImageData: image };
    }

    // Generate new credential
    const { token, tokenHash } = this.generateToken();
    const qrImageData = await this.generateQRImage(token);
    const id = `qr-${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO qr_credentials (id, student_id, room_allocation_id, token_hash, status, issued_at, last_issued_at, qr_image_data, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)
    `).run(id, studentId, allocationId, tokenHash, now, now, qrImageData, now, now);

    const credential = db.prepare('SELECT * FROM qr_credentials WHERE id = ?').get(id);
    return { credential, token, qrImageData };
  }

  /**
   * Verifies a scanned or typed QR token.
   * Camera/network issues or invalid tokens return structured verification outcome.
   */
  static verifyToken(rawToken: string, adminId?: string, method: VerificationMethod = 'MANUAL_ENTRY'): {
    outcome: AccessOutcome;
    reason: string;
    student?: any;
    room?: any;
    hostel?: any;
    allocation?: any;
    credential?: any;
  } {
    const db = getDb();
    const clean = rawToken.trim().replace(/^HOSTEL-ID-PASS:/, '');
    const tokenHash = crypto.createHash('sha256').update(clean).digest('hex');

    // Also check direct match on token_hash in case hash itself was provided
    const credential = db.prepare(`
      SELECT q.*, 
             s.full_name, s.phone_number, s.gender, s.department, s.academic_level, s.photo_url,
             ra.accommodation_start_date, ra.accommodation_end_date, ra.status as allocation_status,
             r.room_number, r.capacity, r.price_per_student,
             h.name as hostel_name, h.code as hostel_code
      FROM qr_credentials q
      JOIN students s ON q.student_id = s.id
      JOIN room_allocations ra ON q.room_allocation_id = ra.id
      JOIN rooms r ON ra.room_id = r.id
      JOIN hostels h ON r.hostel_id = h.id
      WHERE q.token_hash = ? OR q.token_hash = ?
    `).get(tokenHash, clean) as any;

    const logId = `acc-${crypto.randomUUID()}`;

    if (!credential) {
      // Unknown credential
      db.prepare(`
        INSERT INTO access_logs (id, qr_credential_id, student_id, verified_by_admin_id, verification_method, outcome, reason, logged_at)
        VALUES (?, NULL, NULL, ?, ?, 'DENIED', 'Invalid or unrecognised QR token', datetime('now'))
      `).run(logId, adminId || null, method);

      return {
        outcome: 'DENIED',
        reason: 'Invalid or unrecognised digital hostel pass token.'
      };
    }

    // Check status
    if (credential.status === 'REVOKED') {
      db.prepare(`
        INSERT INTO access_logs (id, qr_credential_id, student_id, verified_by_admin_id, verification_method, outcome, reason, logged_at)
        VALUES (?, ?, ?, ?, ?, 'DENIED', ?, datetime('now'))
      `).run(logId, credential.id, credential.student_id, adminId || null, method, `Pass is Revoked: ${credential.revoke_reason || 'Administrative hold'}`);

      return {
        outcome: 'DENIED',
        reason: `Pass has been revoked by management (${credential.revoke_reason || 'Administrative hold'}).`,
        student: {
          id: credential.student_id,
          full_name: credential.full_name,
          phone_number: credential.phone_number,
          gender: credential.gender,
          department: credential.department,
          academic_level: credential.academic_level,
          photo_url: credential.photo_url
        },
        room: {
          room_number: credential.room_number,
          capacity: credential.capacity
        },
        hostel: {
          name: credential.hostel_name,
          code: credential.hostel_code
        },
        allocation: {
          start_date: credential.accommodation_start_date,
          end_date: credential.accommodation_end_date,
          status: credential.allocation_status
        },
        credential: {
          id: credential.id,
          status: credential.status,
          revoked_at: credential.revoked_at,
          revoke_reason: credential.revoke_reason
        }
      };
    }

    // Check expiry
    const today = new Date().toISOString().split('T')[0];
    if (credential.accommodation_end_date < today) {
      db.prepare(`
        INSERT INTO access_logs (id, qr_credential_id, student_id, verified_by_admin_id, verification_method, outcome, reason, logged_at)
        VALUES (?, ?, ?, ?, ?, 'DENIED', ?, datetime('now'))
      `).run(logId, credential.id, credential.student_id, adminId || null, method, `Accommodation Expired on ${credential.accommodation_end_date}`);

      return {
        outcome: 'DENIED',
        reason: `Accommodation duration expired on ${credential.accommodation_end_date}. Renewal required.`,
        student: {
          id: credential.student_id,
          full_name: credential.full_name,
          phone_number: credential.phone_number,
          gender: credential.gender,
          department: credential.department,
          academic_level: credential.academic_level,
          photo_url: credential.photo_url
        },
        room: {
          room_number: credential.room_number
        },
        hostel: {
          name: credential.hostel_name,
          code: credential.hostel_code
        },
        allocation: {
          start_date: credential.accommodation_start_date,
          end_date: credential.accommodation_end_date,
          status: credential.allocation_status
        },
        credential: {
          id: credential.id,
          status: 'EXPIRED'
        }
      };
    }

    // Valid pass
    db.prepare(`
      INSERT INTO access_logs (id, qr_credential_id, student_id, verified_by_admin_id, verification_method, outcome, reason, logged_at)
      VALUES (?, ?, ?, ?, ?, 'GRANTED', 'Valid pass verified', datetime('now'))
    `).run(logId, credential.id, credential.student_id, adminId || null, method);

    return {
      outcome: 'GRANTED',
      reason: 'Valid active hostel digital identity confirmed.',
      student: {
        id: credential.student_id,
        full_name: credential.full_name,
        phone_number: credential.phone_number,
        gender: credential.gender,
        department: credential.department,
        academic_level: credential.academic_level,
        photo_url: credential.photo_url
      },
      room: {
        room_number: credential.room_number,
        capacity: credential.capacity
      },
      hostel: {
        name: credential.hostel_name,
        code: credential.hostel_code
      },
      allocation: {
        start_date: credential.accommodation_start_date,
        end_date: credential.accommodation_end_date,
        status: credential.allocation_status
      },
      credential: {
        id: credential.id,
        status: credential.status,
        issued_at: credential.issued_at,
        last_issued_at: credential.last_issued_at
      }
    };
  }

  /**
   * Revoke a student's QR credential
   */
  static revokeCredential(credentialId: string, reason: string): boolean {
    const db = getDb();
    const res = db.prepare(`
      UPDATE qr_credentials 
      SET status = 'REVOKED', revoked_at = datetime('now'), revoke_reason = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(reason, credentialId);
    return res.changes > 0;
  }

  /**
   * Reactivate a revoked QR credential
   */
  static reactivateCredential(credentialId: string): boolean {
    const db = getDb();
    const res = db.prepare(`
      UPDATE qr_credentials 
      SET status = 'ACTIVE', revoked_at = NULL, revoke_reason = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(credentialId);
    return res.changes > 0;
  }
}
