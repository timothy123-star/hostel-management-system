import { getDb } from '../db/connection.js';
import { Payment, PaymentStatus, HostelCode } from '@hostel/shared';
import { AuditService } from './auditService.js';

export class PaymentService {
  static getPayments(status?: PaymentStatus, hostelCode?: HostelCode): Payment[] {
    const db = getDb();
    let query = `
      SELECT p.*, 
             s.full_name as student_name, s.phone_number as student_phone,
             bg.group_code, h.code as hostel_code, h.name as hostel_name
      FROM payments p
      JOIN students s ON p.student_id = s.id
      JOIN booking_groups bg ON p.booking_group_id = bg.id
      JOIN hostels h ON bg.hostel_id = h.id
      WHERE 1=1
    `;
    const params: any[] = [];
    if (status) {
      query += ' AND p.status = ? ';
      params.push(status);
    }
    if (hostelCode) {
      query += ' AND h.code = ? ';
      params.push(hostelCode);
    }
    query += ' ORDER BY p.created_at DESC ';

    return db.prepare(query).all(...params) as Payment[];
  }

  static verifyPayment(paymentId: string, adminId?: string, notes?: string): Payment {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as any;
    if (!existing) {
      throw new Error(`Payment with ID ${paymentId} not found`);
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE payments 
      SET status = 'VERIFIED', verified_by_admin_id = ?, verified_at = ?, notes = COALESCE(?, notes), updated_at = ?
      WHERE id = ?
    `).run(adminId || null, now, notes || null, now, paymentId);

    AuditService.log({
      adminId,
      action: 'VERIFY_PAYMENT',
      entityType: 'PAYMENT',
      entityId: paymentId,
      oldValues: { status: existing.status },
      newValues: { status: 'VERIFIED', verified_at: now, notes },
      notes: `Verified individual payment of $${existing.amount} (Ref: ${existing.reference_code})`
    });

    return db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as Payment;
  }

  static rejectPayment(paymentId: string, reason: string, adminId?: string): Payment {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as any;
    if (!existing) {
      throw new Error(`Payment with ID ${paymentId} not found`);
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE payments 
      SET status = 'REJECTED', verified_by_admin_id = ?, verified_at = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(adminId || null, now, reason, now, paymentId);

    AuditService.log({
      adminId,
      action: 'REJECT_PAYMENT',
      entityType: 'PAYMENT',
      entityId: paymentId,
      oldValues: { status: existing.status },
      newValues: { status: 'REJECTED', notes: reason },
      notes: `Rejected individual payment (Ref: ${existing.reference_code}): ${reason}`
    });

    return db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as Payment;
  }
}
