import crypto from 'crypto';
import { getDb } from '../db/connection.js';
import { AuditService } from './auditService.js';

export type PhotoDisplayDecision = 'GRANTED' | 'DECLINED' | 'WITHDRAWN';
export type PhotoDisplayDecidedBy = 'RESIDENT' | 'MANAGER';

export const PHOTO_DISPLAY_PURPOSE = 'QR_VERIFICATION_DISPLAY';

export const PHOTO_UPLOAD_DISCLOSURE_VERSION = 'display-permission-v1';

/** Disclosure shown to the resident before upload. Uploading after this
 * disclosure grants display permission; no separate consent action exists. */
export const PHOTO_UPLOAD_DISCLOSURE_TEXT =
  'By uploading, you agree that this photograph will be reviewed by hostel management and, ' +
  'once approved, shown alongside your name, facility and room when authorized staff verify ' +
  'your QR identity pass through the authenticated staff scanner. Only authorized hostel ' +
  'personnel can retrieve it. Uploading grants this display permission.';

/**
 * Auditable permission for showing the approved resident photograph when the
 * QR identity pass is scanned by authorized staff through the authenticated
 * staff scanner. The photograph is never embedded in the QR code and is never
 * served to an unauthenticated holder of the credential. Permission is granted by the
 * resident's own upload after the pre-upload disclosure (no separate consent action), and
 * takes effect only after manager approval of that photograph. Latest row
 * per student wins; absence means no permission and the photograph must be
 * withheld (including legacy photographs uploaded before the disclosure).
 */
export const PHOTO_WHATSAPP_DISCLOSURE_TEXT =
  'Before you send a photograph: hostel management will review it and, once approved, it will ' +
  'be shown alongside your name, facility and room when authorized staff verify your QR identity ' +
  'pass through the authenticated staff scanner. Only authorized hostel personnel can retrieve it. ' +
  'Sending your photograph after this notice grants permission for that display purpose only.';

export class PhotoDisplayConsentService {
  /**
   * Records the automatic display permission granted by a student upload made
   * after the pre-upload disclosure. Called from the photo submit paths so
   * every new submission carries its own auditable permission grant.
   */
  static recordUploadPermission(studentId: string): { status: PhotoDisplayDecision; decidedAt: string } {
    return this.recordDecision({
      studentId,
      decision: 'GRANTED',
      decidedBy: 'RESIDENT',
      notes: `Photo-display permission granted via student upload disclosure (${PHOTO_UPLOAD_DISCLOSURE_VERSION}) for QR identity verification.`,
    });
  }

  static recordDecision(params: {
    studentId: string;
    decision: PhotoDisplayDecision;
    decidedBy: PhotoDisplayDecidedBy;
    adminId?: string | null;
    notes?: string | null;
  }): { status: PhotoDisplayDecision; decidedAt: string } {
    const db = getDb();
    const student = db.prepare('SELECT id FROM students WHERE id = ?').get(params.studentId) as any;
    if (!student) throw new Error('Student not found.');
    if (params.decidedBy === 'MANAGER' && !params.adminId) {
      throw new Error('An authenticated manager is required to record consent.');
    }
    const now = new Date().toISOString();
    const id = `pdc-${crypto.randomUUID()}`;
    db.prepare(`INSERT INTO photo_display_consents (id, student_id, purpose, decision, decided_by, decided_by_admin_id, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, params.studentId, PHOTO_DISPLAY_PURPOSE, params.decision, params.decidedBy,
      params.decidedBy === 'MANAGER' ? params.adminId || null : null,
      params.notes?.slice(0, 500) || null, now
    );
    AuditService.log({
      adminId: params.decidedBy === 'MANAGER' ? params.adminId || undefined : undefined,
      action: params.decision === 'GRANTED' ? 'GRANT_PHOTO_DISPLAY_CONSENT' : params.decision === 'WITHDRAWN' ? 'WITHDRAW_PHOTO_DISPLAY_CONSENT' : 'DECLINE_PHOTO_DISPLAY_CONSENT',
      entityType: 'STUDENT',
      entityId: params.studentId,
      newValues: { purpose: PHOTO_DISPLAY_PURPOSE, decision: params.decision, decided_by: params.decidedBy },
      notes: params.notes || `${params.decidedBy} recorded photo-display consent: ${params.decision}`,
    });
    return { status: params.decision, decidedAt: now };
  }

  static getCurrentStatus(studentId: string): { consented: boolean; decision: PhotoDisplayDecision | 'NONE'; decidedAt?: string } {
    const row = getDb().prepare(`SELECT decision, created_at FROM photo_display_consents
      WHERE student_id = ? AND purpose = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`)
      .get(studentId, PHOTO_DISPLAY_PURPOSE) as any;
    if (!row) return { consented: false, decision: 'NONE' };
    return { consented: row.decision === 'GRANTED', decision: row.decision, decidedAt: row.created_at };
  }

  static hasDisplayConsent(studentId: string): boolean {
    return this.getCurrentStatus(studentId).consented;
  }

  static getHistory(studentId: string): any[] {
    return getDb().prepare(`SELECT pc.*, au.full_name as decided_by_admin_name FROM photo_display_consents pc
      LEFT JOIN admin_users au ON au.id = pc.decided_by_admin_id
      WHERE pc.student_id = ? AND pc.purpose = ? ORDER BY pc.created_at ASC`).all(studentId, PHOTO_DISPLAY_PURPOSE);
  }
}
