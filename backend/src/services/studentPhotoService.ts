import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDb } from '../db/connection.js';
import { config } from '../config.js';
import { AuditService } from './auditService.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
type ImageType = { extension: 'jpg' | 'png' | 'webp'; mimeType: string };

function imageType(buffer: Buffer): ImageType | null {
  // PNG: signature, IHDR dimensions, and an IEND chunk are required.
  if (buffer.length >= 33 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      buffer.subarray(12, 16).toString('ascii') === 'IHDR' && buffer.readUInt32BE(16) > 0 && buffer.readUInt32BE(20) > 0 &&
      buffer.includes(Buffer.from('IEND'))) return { extension: 'png', mimeType: 'image/png' };

  // JPEG: locate a Start Of Frame marker with valid non-zero dimensions.
  if (buffer.length >= 10 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    for (let i = 2; i + 9 < buffer.length; i++) {
      if (buffer[i] !== 0xff) continue;
      const marker = buffer[i + 1];
      if (marker >= 0xc0 && marker <= 0xc3 && buffer.readUInt16BE(i + 5) > 0 && buffer.readUInt16BE(i + 7) > 0) {
        return { extension: 'jpg', mimeType: 'image/jpeg' };
      }
    }
  }

  // WebP must be a RIFF WebP container with a recognised image payload chunk.
  if (buffer.length >= 16 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP' &&
      ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.subarray(12, 16).toString('ascii'))) return { extension: 'webp', mimeType: 'image/webp' };
  return null;
}

export class StudentPhotoService {
  static issueUploadLink(studentId: string, adminId: string, ttlMinutes = 60) {
    const db = getDb();
    const eligible = db.prepare(`
      SELECT s.id, s.phone_number FROM students s
      WHERE s.id = ?
        AND EXISTS (SELECT 1 FROM room_allocations ra WHERE ra.student_id = s.id AND ra.status = 'FINALIZED')
        AND EXISTS (SELECT 1 FROM payments p WHERE p.student_id = s.id AND p.status = 'VERIFIED')
    `).get(studentId) as any;
    if (!eligible) throw new Error('Student must have a finalized accommodation and verified payment before a photo link can be issued.');

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString();
    db.transaction(() => {
      db.prepare('UPDATE student_photo_upload_links SET invalidated_at = ? WHERE student_id = ? AND used_at IS NULL AND invalidated_at IS NULL').run(now.toISOString(), studentId);
      db.prepare(`INSERT INTO student_photo_upload_links (id, student_id, token_hash, expires_at, created_by_admin_id, created_at)
                  VALUES (?, ?, ?, ?, ?, ?)`)
        .run(`photo-link-${crypto.randomUUID()}`, studentId, tokenHash, expiresAt, adminId, now.toISOString());
    })();
    AuditService.log({ adminId, action: 'ISSUE_STUDENT_PHOTO_UPLOAD_LINK', entityType: 'STUDENT', entityId: studentId, newValues: { expires_at: expiresAt }, notes: 'Issued a single-use secure photograph upload link.' });
    return { uploadUrl: `${config.publicAppUrl}/photo-upload/${rawToken}`, expiresAt, phoneNumber: eligible.phone_number };
  }

  static validateLink(rawToken: string) {
    const link = this.getUsableLink(rawToken);
    return { expiresAt: link.expires_at };
  }

  static submitPhoto(rawToken: string, body: Buffer) {
    if (!Buffer.isBuffer(body) || body.length === 0) throw new Error('A photograph is required.');
    if (body.length > MAX_IMAGE_BYTES) throw new Error('Photograph must be 5 MB or smaller.');
    const type = imageType(body);
    if (!type) throw new Error('Upload must contain a valid JPEG, PNG, or WebP image.');

    const db = getDb();
    const link = this.getUsableLink(rawToken);
    const storageKey = `${crypto.randomUUID()}.${type.extension}`;
    const submissionId = `photo-submission-${crypto.randomUUID()}`;
    const storageDir = config.photoStorageDir;
    const storagePath = path.resolve(storageDir, storageKey);
    if (path.dirname(storagePath) !== path.resolve(storageDir)) throw new Error('Invalid storage path.');
    fs.mkdirSync(storageDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(storagePath, body, { flag: 'wx', mode: 0o600 });
    const now = new Date().toISOString();
    try {
      db.transaction(() => {
        const consumed = db.prepare(`UPDATE student_photo_upload_links SET used_at = ?
          WHERE id = ? AND used_at IS NULL AND invalidated_at IS NULL AND expires_at > ?`).run(now, link.id, now);
        if (consumed.changes !== 1) throw new Error('This upload link is no longer valid.');
        db.prepare(`UPDATE students SET photo_storage_key = ?, photo_status = 'PENDING_REVIEW', updated_at = ? WHERE id = ?`)
          .run(storageKey, now, link.student_id);
        db.prepare(`INSERT INTO student_photo_submissions (id, student_id, storage_key, mime_type, status, submitted_at)
          VALUES (?, ?, ?, ?, 'PENDING_REVIEW', ?)`)
          .run(submissionId, link.student_id, storageKey, type.mimeType, now);
      })();
    } catch (error) {
      fs.rmSync(storagePath, { force: true });
      throw error;
    }
    AuditService.log({ action: 'SUBMIT_STUDENT_PHOTO', entityType: 'STUDENT', entityId: link.student_id, newValues: { photo_status: 'PENDING_REVIEW', submission_id: submissionId }, notes: 'Photograph submitted and awaiting management review.' });
    return { status: 'PENDING_REVIEW', mimeType: type.mimeType };
  }

  static getReviewQueue(status = 'PENDING_REVIEW') {
    if (!['PENDING_REVIEW', 'APPROVED', 'REJECTED'].includes(status)) throw new Error('Invalid photograph review status.');
    return getDb().prepare(`
      SELECT s.id as student_id, s.full_name, s.phone_number, s.department, s.academic_level, s.gender,
             ps.status as photo_status, ps.id as submission_id, ps.submitted_at, ps.reviewed_at, ps.rejection_reason,
             reviewer.full_name as reviewer_name, r.room_number
      FROM students s
      JOIN student_photo_submissions ps ON ps.storage_key = s.photo_storage_key
      LEFT JOIN admin_users reviewer ON reviewer.id = ps.reviewed_by_admin_id
      LEFT JOIN room_allocations ra ON ra.student_id = s.id AND ra.status = 'FINALIZED'
      LEFT JOIN rooms r ON r.id = ra.room_id
      WHERE ps.status = ?
      ORDER BY ps.submitted_at ASC
    `).all(status);
  }

  static getPhotoForManager(studentId: string) {
    const photo = getDb().prepare(`SELECT ps.storage_key, ps.mime_type FROM students s
      JOIN student_photo_submissions ps ON ps.storage_key = s.photo_storage_key
      WHERE s.id = ?`).get(studentId) as any;
    if (!photo) throw new Error('No submitted photograph was found for this student.');
    const storagePath = path.resolve(config.photoStorageDir, photo.storage_key);
    if (path.dirname(storagePath) !== path.resolve(config.photoStorageDir) || !fs.existsSync(storagePath)) {
      throw new Error('Submitted photograph is unavailable.');
    }
    return { storagePath, mimeType: photo.mime_type };
  }

  static reviewPhoto(studentId: string, decision: 'APPROVED' | 'REJECTED', adminId: string, rejectionReason?: string) {
    if (decision === 'REJECTED' && !rejectionReason?.trim()) throw new Error('A rejection reason is required.');
    const db = getDb();
    const current = db.prepare(`SELECT s.photo_storage_key, ps.id, ps.status FROM students s
      JOIN student_photo_submissions ps ON ps.storage_key = s.photo_storage_key
      WHERE s.id = ?`).get(studentId) as any;
    if (!current || current.status !== 'PENDING_REVIEW') throw new Error('Only a currently pending photograph can be reviewed.');
    const now = new Date().toISOString();
    db.transaction(() => {
      const changed = db.prepare(`UPDATE student_photo_submissions
        SET status = ?, reviewed_by_admin_id = ?, reviewed_at = ?, rejection_reason = ?
        WHERE id = ? AND status = 'PENDING_REVIEW'`).run(decision, adminId, now, decision === 'REJECTED' ? rejectionReason!.trim() : null, current.id);
      if (changed.changes !== 1) throw new Error('Only a currently pending photograph can be reviewed.');
      // The submission is the authoritative review state. Keep the legacy
      // current-photo field at PENDING_REVIEW for old SQLite databases whose
      // CHECK constraint predates approval/rejection states.
      db.prepare('UPDATE students SET updated_at = ? WHERE id = ?').run(now, studentId);
    })();
    AuditService.log({ adminId, action: decision === 'APPROVED' ? 'APPROVE_STUDENT_PHOTO' : 'REJECT_STUDENT_PHOTO', entityType: 'STUDENT', entityId: studentId, oldValues: { photo_status: 'PENDING_REVIEW' }, newValues: { photo_status: decision }, notes: decision === 'REJECTED' ? rejectionReason!.trim() : 'Photograph approved by manager.' });
    return { status: decision, reviewedAt: now };
  }

  static getReviewHistory(studentId: string) {
    return getDb().prepare(`SELECT ps.id, ps.status, ps.submitted_at, ps.reviewed_at, ps.rejection_reason,
      reviewer.full_name as reviewer_name
      FROM student_photo_submissions ps
      LEFT JOIN admin_users reviewer ON reviewer.id = ps.reviewed_by_admin_id
      WHERE ps.student_id = ? ORDER BY ps.submitted_at ASC`).all(studentId);
  }

  static authorizeReplacement(studentId: string, adminId: string) {
    const student = getDb().prepare(`SELECT ps.status FROM students s
      JOIN student_photo_submissions ps ON ps.storage_key = s.photo_storage_key WHERE s.id = ?`).get(studentId) as any;
    if (!student || student.status !== 'REJECTED') throw new Error('Only a rejected photograph can be authorized for replacement.');
    return this.issueUploadLink(studentId, adminId);
  }

  private static getUsableLink(rawToken: string): any {
    if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) throw new Error('This upload link is invalid.');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const link = getDb().prepare(`SELECT * FROM student_photo_upload_links
      WHERE token_hash = ? AND used_at IS NULL AND invalidated_at IS NULL AND expires_at > ?`).get(tokenHash, new Date().toISOString()) as any;
    if (!link) throw new Error('This upload link is invalid, expired, or has already been used.');
    return link;
  }
}
