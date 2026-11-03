import crypto from 'crypto';
import { getDb } from '../db/connection.js';
import { RenewalOverview } from '@hostel/shared';
import { WhatsAppService } from './whatsapp/whatsappService.js';
import { AuditService } from './auditService.js';

export class RenewalService {
  /**
   * Calculates days between today and end date.
   */
  static getDaysRemaining(endDateStr: string): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [year, month, day] = endDateStr.split('-').map(Number);
    const end = new Date(year, month - 1, day);
    end.setHours(0, 0, 0, 0);

    const diffMs = end.getTime() - today.getTime();
    return Math.round(diffMs / (1000 * 60 * 60 * 24));
  }

  /**
   * Retrieves all students with finalized accommodations, their expiry dates,
   * days remaining, and renewal urgency category.
   */
  static getUpcomingRenewals(filterUrgency?: string): RenewalOverview[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT s.id as student_id, s.full_name as student_name, s.phone_number, s.gender,
             r.room_number, h.name as hostel_name,
             ra.id as allocation_id, ra.accommodation_start_date, ra.accommodation_end_date
      FROM room_allocations ra
      JOIN students s ON ra.student_id = s.id
      JOIN rooms r ON ra.room_id = r.id
      JOIN hostels h ON r.hostel_id = h.id
      WHERE ra.status = 'FINALIZED'
      ORDER BY ra.accommodation_end_date ASC
    `).all() as any[];

    const results: RenewalOverview[] = rows.map(r => {
      const days = this.getDaysRemaining(r.accommodation_end_date);
      let urgency: RenewalOverview['urgency'] = 'UPCOMING';

      if (days < 0) {
        urgency = 'EXPIRED';
      } else if (days <= 7) {
        urgency = 'CRITICAL_7_DAYS';
      } else if (days <= 14) {
        urgency = 'WARNING_14_DAYS';
      } else if (days <= 30) {
        urgency = 'NOTICE_30_DAYS';
      }

      // Check last reminder log
      const lastLog = db.prepare(`
        SELECT notification_type, sent_at 
        FROM notification_logs 
        WHERE student_id = ? AND notification_type LIKE 'RENEWAL_REMINDER_%'
        ORDER BY sent_at DESC LIMIT 1
      `).get(r.student_id) as any;

      return {
        student_id: r.student_id,
        student_name: r.student_name,
        phone_number: r.phone_number,
        gender: r.gender,
        room_number: r.room_number,
        hostel_name: r.hostel_name,
        allocation_id: r.allocation_id,
        accommodation_start_date: r.accommodation_start_date,
        accommodation_end_date: r.accommodation_end_date,
        days_remaining: days,
        urgency,
        last_reminder_sent_at: lastLog ? lastLog.sent_at : null,
        last_reminder_type: lastLog ? lastLog.notification_type : null
      };
    });

    if (filterUrgency && filterUrgency !== 'ALL') {
      return results.filter(item => item.urgency === filterUrgency);
    }

    return results;
  }

  /**
   * Previews renewal reminder template message for a student.
   */
  static previewReminderMessage(studentName: string, roomNumber: string, hostelName: string, endDate: string, daysRemaining: number): string {
    const daysText = daysRemaining < 0
      ? `expired on ${endDate}`
      : daysRemaining === 0
      ? 'expires today!'
      : `expires in ${daysRemaining} day(s) on ${endDate}`;

    return `🏛️ *HOSTEL ACCOMMODATION RENEWAL NOTICE*\n\n` +
      `Dear ${studentName},\n` +
      `Your accommodation at *${hostelName} (Room ${roomNumber})* ${daysText}.\n\n` +
      `Please contact the hostel management office or reply to this WhatsApp line to initiate your renewal for the upcoming academic session.\n\n` +
      `_Note: Renewal is subject to room availability and clearance._`;
  }

  /**
   * Sends renewal reminder via WhatsApp (simulated or live Meta Cloud API) to selected students.
   */
  static async sendRenewalReminders(params: {
    studentIds: string[];
    reminderType: '30_DAYS' | '14_DAYS' | '7_DAYS' | 'MANUAL_NOTICE';
    adminId?: string;
  }): Promise<{ sent: number; failed: number; logs: any[] }> {
    const db = getDb();
    const students = this.getUpcomingRenewals().filter(s => params.studentIds.includes(s.student_id));
    const provider = WhatsAppService.getProvider();
    const isLive = provider.isLive();

    let sent = 0;
    let failed = 0;
    const logs: any[] = [];

    for (const stu of students) {
      const message = this.previewReminderMessage(
        stu.student_name,
        stu.room_number,
        stu.hostel_name,
        stu.accommodation_end_date,
        stu.days_remaining
      );

      try {
        await provider.sendTextMessage(stu.phone_number, message);
        sent++;

        const logId = `nlog-${crypto.randomUUID()}`;
        const notifType = `RENEWAL_REMINDER_${params.reminderType}`;
        const status = isLive ? 'SENT' : 'SIMULATED';

        db.prepare(`
          INSERT INTO notification_logs (id, student_id, notification_type, channel, status, payload, sent_at)
          VALUES (?, ?, ?, 'WHATSAPP', ?, ?, datetime('now'))
        `).run(logId, stu.student_id, notifType, status, JSON.stringify({ message, phone: stu.phone_number }));

        logs.push({ student_id: stu.student_id, student_name: stu.student_name, status });
      } catch (err: any) {
        failed++;
        console.error(`Failed to send renewal reminder to ${stu.student_name}:`, err);
        logs.push({ student_id: stu.student_id, student_name: stu.student_name, status: 'FAILED', error: err.message });
      }
    }

    AuditService.log({
      adminId: params.adminId,
      action: 'SEND_RENEWAL_REMINDERS',
      entityType: 'RENEWAL',
      entityId: `batch-${Date.now()}`,
      newValues: { reminderType: params.reminderType, recipientCount: params.studentIds.length, sent, failed },
      notes: `Sent ${sent} renewal reminders (${params.reminderType}) via WhatsApp (${isLive ? 'Live' : 'Simulated'})`
    });

    return { sent, failed, logs };
  }
}
