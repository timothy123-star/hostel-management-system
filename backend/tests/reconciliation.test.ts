import { beforeEach, describe, expect, it } from 'vitest';
import { runSeed } from '../src/db/seed.js';
import { getDb } from '../src/db/connection.js';
import { PaymentService } from '../src/services/paymentService.js';
import { AllocationService } from '../src/services/allocationService.js';

describe('DEMO bank transfer reconciliation', () => {
  beforeEach(async () => { await runSeed(true); getDb().prepare("UPDATE payments SET status = 'PENDING', verified_by_admin_id = NULL, verified_at = NULL WHERE id = 'pay-demo-04'").run(); });

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

  it('reconciles only an exact individual amount, reference, and beneficiary without approving the payment', () => {
    const txn = PaymentService.simulateBankTransfer('+15553003001');
    const reconciled = PaymentService.reconcileDemoTransaction(txn.id, 'admin-root-01');
    expect(reconciled.status).toBe('PENDING');
    expect(reconciled.reconciliation_status).toBe('RECONCILED');
    expect(reconciled.verified_by_admin_id).toBeNull();
    expect(reconciled.verified_at).toBeNull();
    expect(getDb().prepare("SELECT id FROM audit_logs WHERE action = 'RECONCILE_DEMO_BANK_TRANSACTION' AND entity_id = ?").get(txn.id)).toBeTruthy();
    expect(() => PaymentService.reconcileDemoTransaction(txn.id, 'admin-root-01')).toThrow(/already been resolved/i);
  });

  it('requires a manager approval after reconciliation and records that approval', () => {
    const txn = PaymentService.simulateBankTransfer('+15553003001');
    const reconciled = PaymentService.reconcileDemoTransaction(txn.id, 'admin-root-01');
    const approved = PaymentService.verifyPayment(reconciled.id, 'admin-root-01', 'Manager reviewed matched bank transaction');

    expect(approved.status).toBe('VERIFIED');
    expect(approved.reconciliation_status).toBe('RECONCILED');
    expect(approved.verified_by_admin_id).toBe('admin-root-01');
    expect(approved.verified_at).toBeTruthy();
    expect(() => PaymentService.verifyPayment(approved.id, 'admin-root-01')).toThrow(/only pending payments/i);
  });

  it('does not allow approval while reconciliation is still pending or after payment rejection', () => {
    const txn = PaymentService.simulateBankTransfer('+15553003001');
    expect(() => PaymentService.verifyPayment(txn.linked_payment_id, 'admin-root-01')).toThrow(/must be reconciled/i);

    PaymentService.rejectPayment(txn.linked_payment_id, 'Payment evidence rejected', 'admin-root-01');
    expect(() => PaymentService.verifyPayment(txn.linked_payment_id, 'admin-root-01')).toThrow(/only pending payments/i);
    expect(() => PaymentService.rejectPayment(txn.linked_payment_id, 'Repeated rejection', 'admin-root-01')).toThrow(/only pending payments/i);
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

  it('rejecting a bank transaction does not reject the linked student payment', () => {
    const txn = PaymentService.simulateBankTransfer('+15553003001');
    PaymentService.rejectDemoTransaction(txn.id, 'Incorrect transaction details', 'admin-root-01');

    const payment = getDb().prepare('SELECT status FROM payments WHERE id = ?').get(txn.linked_payment_id) as any;
    expect(payment.status).toBe('PENDING');
    const stored = getDb().prepare('SELECT reconciliation_status FROM demo_bank_transactions WHERE id = ?').get(txn.id) as any;
    expect(stored.reconciliation_status).toBe('REJECTED');
  });

  it('preserves the group payment gate after reconciliation and releases it only after manager approval', async () => {
    const first = PaymentService.simulateBankTransfer('+15553003003');
    const reconciled = PaymentService.reconcileDemoTransaction(first.id, 'admin-root-01');
    await expect(AllocationService.finalizeGroupAllocation({ groupId: 'grp-demo-03', adminId: 'admin-root-01', accommodationStartDate: '2026-12-01' })).rejects.toThrow(/not yet verified/i);

    PaymentService.verifyPayment(reconciled.id, 'admin-root-01');
    PaymentService.verifyPayment('pay-demo-04', 'admin-root-01', 'Manager approved other group member payment evidence');
    const allocation = await AllocationService.finalizeGroupAllocation({ groupId: 'grp-demo-03', adminId: 'admin-root-01', accommodationStartDate: '2026-12-01' });
    expect(allocation.allocations).toHaveLength(3);
  });
});
