import { beforeEach, describe, expect, it } from 'vitest';
import { runSeed } from '../src/db/seed.js';
import { getDb } from '../src/db/connection.js';
import { PaymentService } from '../src/services/paymentService.js';
import { AllocationService } from '../src/services/allocationService.js';

describe('DEMO bank transfer reconciliation', () => {
  beforeEach(async () => { await runSeed(true); getDb().prepare("UPDATE payments SET status = 'PENDING', verified_at = NULL WHERE id = 'pay-demo-04'").run(); });

  it('creates student-specific instructions and a transfer without verifying payment', () => {
    const instructions = PaymentService.getStudentInstructions('+15553003001');
    expect(instructions.payment.reference_code).toBeTruthy();
    expect(instructions.payment.room_number).toBe('M-301');
    const txn = PaymentService.simulateBankTransfer('+15553003001');
    expect(txn.provider_type).toBe('DEMO_BANK');
    expect(txn.reconciliation_status).toBe('PENDING_RECONCILIATION');
    const payment = getDb().prepare('SELECT * FROM payments WHERE id = ?').get(txn.linked_payment_id) as any;
    expect(payment.status).toBe('PENDING');
    expect(payment.reconciliation_status).toBe('AWAITING_RECONCILIATION');
    expect(() => PaymentService.simulateBankTransfer('+15553003001')).toThrow(/already exists/i);
  });

  it('reconciles only an exact individual amount, reference, and beneficiary and audits it', () => {
    const txn = PaymentService.simulateBankTransfer('+15553003001');
    const settled = PaymentService.reconcileDemoTransaction(txn.id, 'admin-root-01');
    expect(settled.status).toBe('VERIFIED');
    expect(settled.reconciliation_status).toBe('RECONCILED');
    expect(getDb().prepare("SELECT id FROM audit_logs WHERE action = 'RECONCILE_DEMO_BANK_TRANSACTION' AND entity_id = ?").get(txn.id)).toBeTruthy();
    expect(() => PaymentService.reconcileDemoTransaction(txn.id, 'admin-root-01')).toThrow(/already been resolved/i);
  });

  it('flags incorrect amount, reference, or beneficiary without settling the payment', () => {
    const txn = PaymentService.simulateBankTransfer('+15553003001');
    getDb().prepare('UPDATE demo_bank_transactions SET amount = amount + 1 WHERE id = ?').run(txn.id);
    expect(() => PaymentService.reconcileDemoTransaction(txn.id, 'admin-root-01')).toThrow(/amount/i);
    const payment = getDb().prepare('SELECT * FROM payments WHERE id = ?').get(txn.linked_payment_id) as any;
    expect(payment.status).toBe('PENDING');
    const stored = getDb().prepare('SELECT reconciliation_status FROM demo_bank_transactions WHERE id = ?').get(txn.id) as any;
    expect(stored.reconciliation_status).toBe('EXCEPTION');
  });

  it('preserves the group payment gate until every individual transfer is reconciled', async () => {
    const first = PaymentService.simulateBankTransfer('+15553003001');
    PaymentService.reconcileDemoTransaction(first.id, 'admin-root-01');
    await expect(AllocationService.finalizeGroupAllocation({ groupId: 'grp-demo-03', adminId: 'admin-root-01', accommodationStartDate: '2026-12-01' })).rejects.toThrow(/not yet verified/i);
  });
});
