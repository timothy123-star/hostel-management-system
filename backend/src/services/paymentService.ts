import crypto from 'crypto';
import { getDb } from '../db/connection.js';
import { Payment, PaymentStatus, HostelCode } from '@hostel/shared';
import { AuditService } from './auditService.js';
import { config as appConfig } from '../config.js';
import { WhatsAppNotificationService } from './whatsapp/whatsappNotifications.js';

export class PaymentService {
  static readonly demoBank = { name: 'HostelOS DEMO Bank — NO REAL MONEY', accountName: 'HostelOS Accommodation DEMO ONLY', accountNumber: '0001234567-DEMO' };
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
    if (!adminId) {
      throw new Error('An authenticated manager is required to approve a payment.');
    }
    const existing = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as any;
    if (!existing) {
      throw new Error(`Payment with ID ${paymentId} not found`);
    }
    if (existing.status !== 'PENDING') {
      throw new Error(`Only pending payments can be approved. This payment is already ${existing.status.toLowerCase()}.`);
    }
    if (existing.reconciliation_status === 'AWAITING_RECONCILIATION') {
      throw new Error('This demo transfer must be reconciled from the incoming bank ledger; direct verification is disabled.');
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
      notes: `Manager approved individual payment of $${existing.amount} (Ref: ${existing.reference_code})`
    });

    const verified = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as Payment;
    try {
      const student = db.prepare('SELECT phone_number FROM students WHERE id = ?').get((verified as any).student_id) as any;
      if (student?.phone_number) {
        WhatsAppNotificationService.queueAndSend({
          dedupeKey: `payment-approved:${paymentId}`,
          studentId: (verified as any).student_id,
          phone: student.phone_number,
          kind: 'PAYMENT_APPROVED',
          bodyText: `✅ Payment approved: $${(verified as any).amount} ${(verified as any).currency} (Ref: ${(verified as any).reference_code}). DEMO ONLY — no real money. Please attach a clear face photograph directly to this WhatsApp chat for manager review.`,
          templateName: appConfig.whatsappTemplates.paymentApproved,
          templateParams: [String((verified as any).amount), String((verified as any).currency), String((verified as any).reference_code)],
        });
      }
    } catch { /* notification must not break approval */ }
    return verified;
  }

  static getStudentInstructions(phone: string) {
    const db = getDb();
    const payment = db.prepare(`SELECT p.*, s.full_name, h.name as hostel_name, r.room_number, r.capacity, r.price_per_student
      FROM payments p JOIN students s ON s.id = p.student_id JOIN booking_groups bg ON bg.id = p.booking_group_id
      JOIN hostels h ON h.id = bg.hostel_id LEFT JOIN rooms r ON r.id = bg.held_room_id
      WHERE s.phone_number = ? ORDER BY p.created_at DESC LIMIT 1`).get(phone.trim()) as any;
    if (!payment) throw new Error('No individual payment record was found for this sender.');
    if (!payment.room_number) throw new Error('Payment instructions will be available once your completed group receives a temporary room hold.');
    return { payment, bank: this.demoBank, demoWarning: 'DEMO ONLY — NO REAL MONEY. This does not connect to a bank or payment provider.' };
  }

  static simulateBankTransfer(phone: string) {
    const { payment } = this.getStudentInstructions(phone);
    if (payment.status !== 'PENDING') throw new Error('This payment is no longer pending and cannot receive another demo transfer.');
    const db = getDb();
    const previous = db.prepare(`SELECT id FROM demo_bank_transactions WHERE linked_payment_id = ? AND reconciliation_status != 'REJECTED'`).get(payment.id);
    if (previous) throw new Error('A demo transfer already exists for this payment and is awaiting reconciliation.');
    const now = new Date().toISOString();
    const txnId = `dbt-${crypto.randomUUID()}`;
    const bankRef = `DEMO-BANK-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    db.transaction(() => {
      db.prepare(`INSERT INTO demo_bank_transactions (id, provider_type, bank_transaction_reference, beneficiary_account, payment_reference, amount, currency, transaction_timestamp, sender_description, reconciliation_status, linked_payment_id, idempotency_key, created_at, updated_at)
        VALUES (?, 'DEMO_BANK', ?, ?, ?, ?, ?, ?, ?, 'PENDING_RECONCILIATION', ?, ?, ?, ?)`)
        .run(txnId, bankRef, this.demoBank.accountNumber, payment.reference_code, payment.amount, payment.currency, now, `SIMULATED SENDER: ${payment.full_name}`, payment.id, `simulate:${payment.id}`, now, now);
      db.prepare("UPDATE payments SET reconciliation_status = 'AWAITING_RECONCILIATION', updated_at = ? WHERE id = ?").run(now, payment.id);
    })();
    return db.prepare('SELECT * FROM demo_bank_transactions WHERE id = ?').get(txnId) as any;
  }

  static getDemoTransactions(status?: string) {
    const db = getDb();
    let sql = `SELECT t.*, p.amount as expected_amount, s.full_name as student_name FROM demo_bank_transactions t
      LEFT JOIN payments p ON p.id = t.linked_payment_id LEFT JOIN students s ON s.id = p.student_id WHERE 1=1`;
    const args: any[] = [];
    if (status && status !== 'ALL') { sql += ' AND t.reconciliation_status = ?'; args.push(status); }
    sql += ' ORDER BY t.transaction_timestamp DESC';
    return db.prepare(sql).all(...args);
  }

  static reconcileDemoTransaction(transactionId: string, adminId?: string) {
    const db = getDb(); const txn = db.prepare('SELECT * FROM demo_bank_transactions WHERE id = ?').get(transactionId) as any;
    if (!txn) throw new Error('Demo bank transaction not found.');
    if (txn.reconciliation_status !== 'PENDING_RECONCILIATION') throw new Error('This transaction has already been resolved.');
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(txn.linked_payment_id) as any;
    const failure = txn.beneficiary_account !== this.demoBank.accountNumber ? 'Beneficiary account does not match the configured DEMO account.'
      : !payment ? 'Payment reference did not resolve to an individual payment.'
      : payment.reference_code !== txn.payment_reference ? 'Payment reference/narration does not match the linked student payment.'
      : payment.amount !== txn.amount || payment.currency !== txn.currency ? 'Received amount or currency does not exactly match the expected individual payment.'
      : payment.status !== 'PENDING' ? 'The individual payment has already been settled.' : null;
    const now = new Date().toISOString();
    if (failure) {
      db.prepare("UPDATE demo_bank_transactions SET reconciliation_status = 'EXCEPTION', exception_reason = ?, updated_at = ? WHERE id = ?").run(failure, now, transactionId);
      if (payment) db.prepare("UPDATE payments SET reconciliation_status = 'EXCEPTION', updated_at = ? WHERE id = ?").run(now, payment.id);
      throw new Error(failure);
    }
    db.transaction(() => {
      db.prepare("UPDATE demo_bank_transactions SET reconciliation_status = 'RECONCILED', reconciled_at = ?, reconciled_by_admin_id = ?, updated_at = ? WHERE id = ?").run(now, adminId || null, now, transactionId);
      db.prepare("UPDATE payments SET reconciliation_status = 'RECONCILED', updated_at = ? WHERE id = ?").run(now, payment.id);
    })();
    AuditService.log({ adminId, action: 'RECONCILE_DEMO_BANK_TRANSACTION', entityType: 'DEMO_BANK_TRANSACTION', entityId: transactionId, newValues: { payment_id: payment.id, amount: txn.amount }, notes: `DEMO ONLY reconciliation of ${txn.bank_transaction_reference} to ${payment.reference_code}` });
    return db.prepare('SELECT * FROM payments WHERE id = ?').get(payment.id) as Payment;
  }

  static rejectDemoTransaction(transactionId: string, reason: string, adminId?: string) {
    const db = getDb(); const txn = db.prepare('SELECT * FROM demo_bank_transactions WHERE id = ?').get(transactionId) as any;
    if (!txn) throw new Error('Demo bank transaction not found.');
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare("UPDATE demo_bank_transactions SET reconciliation_status = 'REJECTED', exception_reason = ?, reconciled_at = ?, reconciled_by_admin_id = ?, updated_at = ? WHERE id = ?").run(reason, now, adminId || null, now, transactionId);
      if (txn.linked_payment_id) db.prepare("UPDATE payments SET reconciliation_status = 'REJECTED', updated_at = ? WHERE id = ? AND status = 'PENDING'").run(now, txn.linked_payment_id);
    })();
    AuditService.log({ adminId, action: 'REJECT_DEMO_BANK_TRANSACTION', entityType: 'DEMO_BANK_TRANSACTION', entityId: transactionId, newValues: { reason }, notes: 'DEMO ONLY transaction rejected.' });
  }

  static rejectPayment(paymentId: string, reason: string, adminId?: string): Payment {
    const db = getDb();
    if (!adminId) {
      throw new Error('An authenticated manager is required to reject a payment.');
    }
    const existing = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as any;
    if (!existing) {
      throw new Error(`Payment with ID ${paymentId} not found`);
    }
    if (existing.status !== 'PENDING') {
      throw new Error(`Only pending payments can be rejected. This payment is already ${existing.status.toLowerCase()}.`);
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE payments 
      SET status = 'REJECTED', notes = ?, updated_at = ?
      WHERE id = ?
    `).run(reason, now, paymentId);

    AuditService.log({
      adminId,
      action: 'REJECT_PAYMENT',
      entityType: 'PAYMENT',
      entityId: paymentId,
      oldValues: { status: existing.status },
      newValues: { status: 'REJECTED', notes: reason },
      notes: `Rejected individual payment (Ref: ${existing.reference_code}): ${reason}`
    });

    const rejected = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as Payment;
    try {
      const student = db.prepare('SELECT phone_number FROM students WHERE id = ?').get((rejected as any).student_id) as any;
      if (student?.phone_number) {
        WhatsAppNotificationService.queueAndSend({
          dedupeKey: `payment-rejected:${paymentId}`,
          studentId: (rejected as any).student_id,
          phone: student.phone_number,
          kind: 'PAYMENT_REJECTED',
          bodyText: `❌ Payment not approved (Ref: ${(rejected as any).reference_code}). Reason: ${reason}. DEMO ONLY — no real money. Please correct the issue and tap PAYMENT INSTRUCTIONS to retry; a manager must still verify it.`,
          templateName: appConfig.whatsappTemplates.paymentRejected,
          templateParams: [String((rejected as any).reference_code), String(reason)],
        });
      }
    } catch { /* notification must not break rejection */ }
    return rejected;
  }
}
