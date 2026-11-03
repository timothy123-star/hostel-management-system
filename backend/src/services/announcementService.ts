import crypto from 'crypto';
import { getDb } from '../db/connection.js';
import { Announcement, ComposeAnnouncementInput, AnnouncementAudience } from '@hostel/shared';
import { WhatsAppService } from './whatsapp/whatsappService.js';
import { AuditService } from './auditService.js';
import { RenewalService } from './renewalService.js';

export class AnnouncementService {
  /**
   * Resolves list of student recipients based on audience filter.
   */
  static getEligibleRecipients(audience: AnnouncementAudience, customStudentIds?: string[]): { id: string; full_name: string; phone_number: string; gender: string }[] {
    const db = getDb();

    switch (audience) {
      case 'ALL':
        return db.prepare('SELECT id, full_name, phone_number, gender FROM students ORDER BY full_name ASC').all() as any[];

      case 'MALE':
        return db.prepare('SELECT id, full_name, phone_number, gender FROM students WHERE gender = \'MALE\' ORDER BY full_name ASC').all() as any[];

      case 'FEMALE':
        return db.prepare('SELECT id, full_name, phone_number, gender FROM students WHERE gender = \'FEMALE\' ORDER BY full_name ASC').all() as any[];

      case 'EXPIRING_SOON': {
        const renewals = RenewalService.getUpcomingRenewals();
        const expiringSoon = renewals.filter(r => r.days_remaining <= 30 && r.days_remaining >= -7);
        const ids = expiringSoon.map(r => r.student_id);
        if (ids.length === 0) return [];
        const placeholders = ids.map(() => '?').join(',');
        return db.prepare(`SELECT id, full_name, phone_number, gender FROM students WHERE id IN (${placeholders})`).all(...ids) as any[];
      }

      case 'CUSTOM': {
        if (!customStudentIds || customStudentIds.length === 0) return [];
        const placeholders = customStudentIds.map(() => '?').join(',');
        return db.prepare(`SELECT id, full_name, phone_number, gender FROM students WHERE id IN (${placeholders})`).all(...customStudentIds) as any[];
      }

      default:
        return [];
    }
  }

  /**
   * Previews announcement text and resolved recipients.
   */
  static previewAnnouncement(input: ComposeAnnouncementInput): {
    previewText: string;
    totalRecipients: number;
    recipients: { id: string; full_name: string; phone_number: string; gender: string }[];
  } {
    const recipients = this.getEligibleRecipients(input.target_audience, input.student_ids);
    const previewText = `📢 *HOSTEL OFFICIAL ANNOUNCEMENT*\n\n*${input.title}*\n\n${input.message}\n\n_— Hostel Management Office_`;
    return {
      previewText,
      totalRecipients: recipients.length,
      recipients
    };
  }

  /**
   * Dispatches announcement to resolved recipients via WhatsApp provider (live or simulator).
   */
  static async sendAnnouncement(input: ComposeAnnouncementInput, adminId?: string): Promise<Announcement> {
    const db = getDb();
    const recipients = this.getEligibleRecipients(input.target_audience, input.student_ids);
    const provider = WhatsAppService.getProvider();
    const isLive = provider.isLive();

    const announcementId = `ann-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const formattedMessage = `📢 *HOSTEL OFFICIAL ANNOUNCEMENT*\n\n*${input.title}*\n\n${input.message}\n\n_— Hostel Management Office_`;

    db.prepare(`
      INSERT INTO announcements (id, title, message, target_audience, sent_by_admin_id, status, total_recipients, created_at, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      announcementId,
      input.title,
      input.message,
      input.target_audience,
      adminId || null,
      isLive ? 'SENT' : 'SIMULATED',
      recipients.length,
      now,
      now
    );

    for (const r of recipients) {
      const recipientId = `ar-${crypto.randomUUID()}`;
      let recipientStatus = isLive ? 'SENT' : 'SIMULATED';
      let failureReason: string | null = null;

      try {
        await provider.sendTextMessage(r.phone_number, formattedMessage);
      } catch (err: any) {
        recipientStatus = 'FAILED';
        failureReason = err.message || 'Dispatch error';
      }

      db.prepare(`
        INSERT INTO announcement_recipients (id, announcement_id, student_id, phone_number, status, failure_reason, sent_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(recipientId, announcementId, r.id, r.phone_number, recipientStatus, failureReason, now);
    }

    AuditService.log({
      adminId,
      action: 'SEND_BULK_ANNOUNCEMENT',
      entityType: 'ANNOUNCEMENT',
      entityId: announcementId,
      newValues: {
        title: input.title,
        target_audience: input.target_audience,
        total_recipients: recipients.length,
        status: isLive ? 'SENT' : 'SIMULATED'
      },
      notes: `Dispatched bulk announcement to ${recipients.length} students via WhatsApp (${isLive ? 'Meta Cloud API' : 'Simulator'})`
    });

    return this.getAnnouncementById(announcementId)!;
  }

  static getAnnouncements(): Announcement[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM announcements ORDER BY created_at DESC').all() as Announcement[];
    return rows;
  }

  static getAnnouncementById(announcementId: string): Announcement | null {
    const db = getDb();
    const ann = db.prepare('SELECT * FROM announcements WHERE id = ?').get(announcementId) as any;
    if (!ann) return null;

    const recipients = db.prepare(`
      SELECT ar.*, s.full_name as student_name
      FROM announcement_recipients ar
      JOIN students s ON ar.student_id = s.id
      WHERE ar.announcement_id = ?
    `).all(announcementId) as any[];

    return {
      ...ann,
      recipients
    };
  }
}
