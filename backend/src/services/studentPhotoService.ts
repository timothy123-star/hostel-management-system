import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDb } from '../db/connection.js';
import { config } from '../config.js';
import { AuditService } from './auditService.js';
import { config as appConfig } from '../config.js';
import { PHOTO_DISPLAY_PURPOSE, PHOTO_UPLOAD_DISCLOSURE_VERSION } from './photoDisplayConsentService.js';
import { WhatsAppNotificationService } from './whatsapp/whatsappNotifications.js';

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
    const current = db.prepare(`SELECT s.photo_storage_key, ps.status FROM students s
      LEFT JOIN student_photo_submissions ps ON ps.storage_key = s.photo_storage_key
      WHERE s.id = ?`).get(link.student_id) as any;
    // A new upload while an approved photograph is active is a replacement
    // candidate: the current approved photo stays active until a manager
    // approves the replacement. Otherwise this upload becomes the current photo.
    const isReplacement = !!current?.photo_storage_key && current.status === 'APPROVED';
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
        if (!isReplacement) {
          db.prepare(`UPDATE students SET photo_storage_key = ?, photo_status = 'PENDING_REVIEW', updated_at = ? WHERE id = ?`)
            .run(storageKey, now, link.student_id);
        } else {
          db.prepare(`UPDATE students SET updated_at = ? WHERE id = ?`).run(now, link.student_id);
        }
        db.prepare(`INSERT INTO student_photo_submissions (id, student_id, storage_key, mime_type, status, submitted_at)
          VALUES (?, ?, ?, ?, 'PENDING_REVIEW', ?)`)
          .run(submissionId, link.student_id, storageKey, type.mimeType, now);
        // Upload after the pre-upload disclosure grants display permission
        // (effective only after manager approval). Recorded in the same
        // transaction as the submission so they cannot diverge.
        db.prepare(`INSERT INTO photo_display_consents (id, student_id, purpose, decision, decided_by, decided_by_admin_id, notes, created_at)
          VALUES (?, ?, ?, 'GRANTED', 'RESIDENT', NULL, ?, ?)`)
          .run(`pdc-${crypto.randomUUID()}`, link.student_id, PHOTO_DISPLAY_PURPOSE,
            `Photo-display permission granted via student upload disclosure (${PHOTO_UPLOAD_DISCLOSURE_VERSION}) for QR identity verification.`, now);
      })();
    } catch (error) {
      fs.rmSync(storagePath, { force: true });
      throw error;
    }
    AuditService.log({ action: 'SUBMIT_STUDENT_PHOTO', entityType: 'STUDENT', entityId: link.student_id, newValues: { photo_status: 'PENDING_REVIEW', submission_id: submissionId, is_replacement: isReplacement }, notes: isReplacement ? 'Replacement candidate submitted; current approved photograph stays active pending review.' : 'Photograph submitted and awaiting management review.' });
    AuditService.log({ action: 'GRANT_PHOTO_DISPLAY_CONSENT', entityType: 'STUDENT', entityId: link.student_id, newValues: { purpose: PHOTO_DISPLAY_PURPOSE, decision: 'GRANTED', decided_by: 'RESIDENT' }, notes: `Photo-display permission granted via student upload disclosure (${PHOTO_UPLOAD_DISCLOSURE_VERSION}).` });
    return { status: 'PENDING_REVIEW', mimeType: type.mimeType, isReplacement };
  }

  static submitWhatsAppPhoto(studentId: string, body: Buffer, source: { messageId: string; phoneNumber: string }, options?: { disclosureVersion?: string }) {
    if (!Buffer.isBuffer(body) || body.length === 0) throw new Error('The received photograph was empty. Please resend it.');
    if (body.length > MAX_IMAGE_BYTES) throw new Error('The photograph must be 5 MB or smaller.');
    const type = imageType(body);
    if (!type) throw new Error('Please send a JPEG, PNG, or WebP photograph.');
    // Service-boundary consent enforcement: a caller-supplied version
    // constant is never sufficient. A current disclosure must exist in the
    // database for this exact student and normalized sender phone, recorded
    // before this submission. Anything else fails closed with no image
    // stored and no consent created.
    void options?.disclosureVersion;
    {
      const db = getDb();
      const now = new Date().toISOString();
      const disclosure = db.prepare(
        'SELECT disclosure_version, shown_at FROM whatsapp_photo_disclosures WHERE phone_number = ? AND student_id = ?'
      ).get(source.phoneNumber, studentId) as any;
      if (!disclosure || disclosure.disclosure_version !== PHOTO_UPLOAD_DISCLOSURE_VERSION || !disclosure.shown_at || String(disclosure.shown_at) > now) {
        throw new Error('Photo-display disclosure must be shown before a WhatsApp photograph can be accepted. Please resend the photograph after the disclosure.');
      }
    }

    const db = getDb();
    const student = db.prepare('SELECT id FROM students WHERE id = ?').get(studentId) as any;
    if (!student) throw new Error('Student profile was not found for this WhatsApp number.');
    const current = db.prepare(`SELECT s.photo_storage_key, ps.status FROM students s
      LEFT JOIN student_photo_submissions ps ON ps.storage_key = s.photo_storage_key
      WHERE s.id = ?`).get(studentId) as any;
    // Same replacement rule as dashboard uploads: an approved active photo
    // stays live while the new upload awaits review.
    const isReplacement = !!current?.photo_storage_key && current.status === 'APPROVED';
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
        if (!isReplacement) {
          db.prepare(`UPDATE students SET photo_storage_key = ?, photo_status = 'PENDING_REVIEW', updated_at = ? WHERE id = ?`)
            .run(storageKey, now, studentId);
        } else {
          db.prepare(`UPDATE students SET updated_at = ? WHERE id = ?`).run(now, studentId);
        }
        db.prepare(`INSERT INTO student_photo_submissions (id, student_id, storage_key, mime_type, status, submitted_at)
          VALUES (?, ?, ?, ?, 'PENDING_REVIEW', ?)`)
          .run(submissionId, studentId, storageKey, type.mimeType, now);
        // Upload after the pre-upload disclosure grants display permission
        // (effective only after manager approval). Recorded in the same
        // transaction as the submission so they cannot diverge.
        db.prepare(`INSERT INTO photo_display_consents (id, student_id, purpose, decision, decided_by, decided_by_admin_id, notes, created_at)
          VALUES (?, ?, ?, 'GRANTED', 'RESIDENT', NULL, ?, ?)`)
          .run(`pdc-${crypto.randomUUID()}`, studentId, PHOTO_DISPLAY_PURPOSE,
            `Photo-display permission granted via student upload disclosure (${PHOTO_UPLOAD_DISCLOSURE_VERSION}) for QR identity verification.`, now);
      })();
    } catch (error) {
      fs.rmSync(storagePath, { force: true });
      throw error;
    }
    AuditService.log({ action: 'SUBMIT_STUDENT_PHOTO', entityType: 'STUDENT', entityId: studentId, newValues: { photo_status: 'PENDING_REVIEW', submission_id: submissionId, source: 'WHATSAPP', is_replacement: isReplacement }, notes: isReplacement ? `Replacement candidate received by WhatsApp (${source.messageId}); current approved photograph stays active pending review.` : `Photograph received by WhatsApp (${source.messageId}) and awaiting management review.` });
    AuditService.log({ action: 'GRANT_PHOTO_DISPLAY_CONSENT', entityType: 'STUDENT', entityId: studentId, newValues: { purpose: PHOTO_DISPLAY_PURPOSE, decision: 'GRANTED', decided_by: 'RESIDENT', source: 'WHATSAPP' }, notes: `Photo-display permission granted via student upload disclosure (${PHOTO_UPLOAD_DISCLOSURE_VERSION}).` });
    return { status: 'PENDING_REVIEW' as const, mimeType: type.mimeType, submissionId, isReplacement };
  }

  static getReviewQueue(status = 'PENDING_REVIEW') {
    if (!['PENDING_REVIEW', 'APPROVED', 'REJECTED'].includes(status)) throw new Error('Invalid photograph review status.');
    // Submissions are listed directly (not via the student's current-photo
    // pointer) so replacement candidates awaiting review are visible. The
    // single source of truth for the active photograph remains
    // students.photo_storage_key, flagged here as is_current_photo.
    return getDb().prepare(`
      SELECT s.id as student_id, s.full_name, s.phone_number, s.department, s.academic_level, s.gender,
             ps.status as photo_status, ps.id as submission_id, ps.storage_key as submission_storage_key, ps.submitted_at, ps.reviewed_at, ps.rejection_reason,
             reviewer.full_name as reviewer_name, r.room_number,
             CASE WHEN s.photo_storage_key = ps.storage_key THEN 1 ELSE 0 END as is_current_photo
      FROM student_photo_submissions ps
      JOIN students s ON s.id = ps.student_id
      LEFT JOIN admin_users reviewer ON reviewer.id = ps.reviewed_by_admin_id
      LEFT JOIN room_allocations ra ON ra.student_id = s.id AND ra.status = 'FINALIZED'
      LEFT JOIN rooms r ON r.id = ra.room_id
      WHERE ps.status = ?
      ORDER BY ps.submitted_at ASC
    `).all(status);
  }

  static getPhotoForManager(studentId: string, submissionId?: string) {
    const photo = submissionId
      ? getDb().prepare(`SELECT ps.storage_key, ps.mime_type FROM student_photo_submissions ps
          WHERE ps.id = ? AND ps.student_id = ?`).get(submissionId, studentId) as any
      : getDb().prepare(`SELECT ps.storage_key, ps.mime_type FROM students s
          JOIN student_photo_submissions ps ON ps.storage_key = s.photo_storage_key
          WHERE s.id = ?`).get(studentId) as any;
    if (!photo) throw new Error('No submitted photograph was found for this student.');
    const storagePath = path.resolve(config.photoStorageDir, photo.storage_key);
    if (path.dirname(storagePath) !== path.resolve(config.photoStorageDir) || !fs.existsSync(storagePath)) {
      throw new Error('Submitted photograph is unavailable.');
    }
    return { storagePath, mimeType: photo.mime_type };
  }

  static reviewPhoto(studentId: string, decision: 'APPROVED' | 'REJECTED', adminId: string, rejectionReason?: string, submissionId?: string) {
    if (decision === 'REJECTED' && !rejectionReason?.trim()) throw new Error('A rejection reason is required.');
    const db = getDb();
    // Review the latest pending submission by default so replacement
    // candidates (which never disturb the active-photo pointer) are
    // reviewable. An explicit submission id targets that exact candidate.
    const target = (submissionId
      ? db.prepare(`SELECT id, storage_key, status, submitted_at FROM student_photo_submissions
          WHERE id = ? AND student_id = ?`).get(submissionId, studentId)
      : db.prepare(`SELECT id, storage_key, status, submitted_at FROM student_photo_submissions
          WHERE student_id = ? AND status = 'PENDING_REVIEW'
          ORDER BY submitted_at DESC, rowid DESC LIMIT 1`).get(studentId)) as any;
    if (!target || target.status !== 'PENDING_REVIEW') throw new Error('Only a currently pending photograph can be reviewed.');
    const pointer = db.prepare('SELECT photo_storage_key FROM students WHERE id = ?').get(studentId) as any;
    // A reviewed submission whose key differs from the active pointer is a
    // replacement: the previous approved photograph stays live until this
    // approval atomically switches the pointer.
    const isReplacement = !!pointer?.photo_storage_key && pointer.photo_storage_key !== target.storage_key;
    const now = new Date().toISOString();
    db.transaction(() => {
      const changed = db.prepare(`UPDATE student_photo_submissions
        SET status = ?, reviewed_by_admin_id = ?, reviewed_at = ?, rejection_reason = ?
        WHERE id = ? AND status = 'PENDING_REVIEW'`).run(decision, adminId, now, decision === 'REJECTED' ? rejectionReason!.trim() : null, target.id);
      if (changed.changes !== 1) throw new Error('Only a currently pending photograph can be reviewed.');
      if (decision === 'APPROVED' && (isReplacement || !pointer?.photo_storage_key)) {
        // Atomic activation: from this commit, scans serve the replacement.
        // The single source of truth stays students.photo_storage_key, so
        // concurrent approvals can never leave two active photographs.
        db.prepare('UPDATE students SET photo_storage_key = ?, photo_status = ?, updated_at = ? WHERE id = ?').run(target.storage_key, 'APPROVED', now, studentId);
      } else if (decision === 'APPROVED') {
        // Initial approval whose pointer was set at upload: the pointer is
        // already correct, but the denormalized status must be synchronized
        // so it stops reporting PENDING_REVIEW for an approved photograph.
        db.prepare("UPDATE students SET photo_status = 'APPROVED', updated_at = ? WHERE id = ?").run(now, studentId);
      } else {
        // Rejections never move the pointer, so an older approved active
        // photograph stays live. Keep the legacy current-photo field
        // untouched for old SQLite databases whose CHECK predates new states.
        db.prepare('UPDATE students SET updated_at = ? WHERE id = ?').run(now, studentId);
      }
      if (decision === 'REJECTED') {
        // Re-arm the WhatsApp pre-upload disclosure so the replacement round
        // receives its own disclosure before the next photograph is accepted.
        db.prepare('DELETE FROM whatsapp_photo_disclosures WHERE student_id = ?').run(studentId);
      }
    })();
    AuditService.log({ adminId, action: decision === 'APPROVED' ? 'APPROVE_STUDENT_PHOTO' : 'REJECT_STUDENT_PHOTO', entityType: 'STUDENT', entityId: studentId, oldValues: { photo_status: 'PENDING_REVIEW' }, newValues: { photo_status: decision, submission_id: target.id, is_replacement: isReplacement }, notes: decision === 'REJECTED' ? rejectionReason!.trim() : (isReplacement ? 'Replacement photograph approved and activated by manager.' : 'Photograph approved by manager.') });
    try {
      const student = db.prepare('SELECT phone_number FROM students WHERE id = ?').get(studentId) as any;
      if (student?.phone_number) {
        if (decision === 'APPROVED') {
          WhatsAppNotificationService.queueAndSend({
            dedupeKey: `photo-approved:${target.id}`,
            studentId, phone: student.phone_number, kind: 'PHOTO_APPROVED',
            bodyText: isReplacement
              ? `✅ Replacement photograph approved and is now the active photograph shown on authorized QR scans. Your QR identity pass continues to work; no new issuance is needed for the photo change.`
              : `✅ Photograph approved. Your QR identity pass still requires explicit manager issuance. You will be notified once it is issued; then send QR to receive it.`,
            templateName: appConfig.whatsappTemplates.photoApproved,
            templateParams: [],
          });
        } else {
          WhatsAppNotificationService.queueAndSend({
            dedupeKey: `photo-rejected:${target.id}`,
            studentId, phone: student.phone_number, kind: 'PHOTO_REJECTED',
            bodyText: isReplacement
              ? `❌ Replacement photograph not approved. Reason: ${rejectionReason!.trim()} Your previously approved photograph remains active on authorized QR scans. To try again, wait for the disclosure notice and resend a clear face photograph (JPEG/PNG/WebP, 5 MB or smaller) directly to this WhatsApp chat after it.`
              : `❌ Photograph not approved. Reason: ${rejectionReason!.trim()} Before resending, you will receive a short disclosure notice: sending a photograph after it grants permission for the approved photo to appear on authorized QR scans. Then attach a clear replacement face photograph directly to this WhatsApp chat (JPEG/PNG/WebP, 5 MB or smaller). Do not use a web link in live mode.`,
            templateName: appConfig.whatsappTemplates.photoRejected,
            templateParams: [rejectionReason!.trim()],
          });
        }
      }
    } catch { /* notification must not break review */ }
    return { status: decision, reviewedAt: now, submissionId: target.id, isReplacement };
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
