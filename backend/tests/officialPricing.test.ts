import { beforeEach, describe, expect, it } from 'vitest';
import { runSeed } from '../src/db/seed.js';
import { getDb } from '../src/db/connection.js';
import {
  OFFICIAL_NGN_KOBO,
  amountsMatch,
  formatOfficialPerResident,
  formatPaymentAmount,
  koboToNaira,
  officialAmountKobo,
  resolveOfficialPricing,
} from '../src/services/monnify/pricing.js';
import { BookingGroupService } from '../src/services/bookingGroupService.js';
import { MatchingService } from '../src/services/matchingService.js';
import { PaymentService } from '../src/services/paymentService.js';
import { AllocationService } from '../src/services/allocationService.js';
import { StudentService } from '../src/services/studentService.js';
import { monnifyStatus } from '../src/services/monnify/monnifyPayments.js';

const mkKnown = (phone: string, gender: 'MALE' | 'FEMALE', cap: 1 | 2 | 3) =>
  StudentService.registerStudent({
    full_name: `Test Resident ${phone.slice(-4)}`,
    phone_number: phone,
    gender,
    department: 'Computer Science',
    academic_level: '100 Level',
    preferred_occupancy: cap,
    roommate_mode: 'KNOWN',
    consent_random_matching: false,
    auto_complete_triple_consent: false,
  } as any);
const mkRandom = (phone: string, gender: 'MALE' | 'FEMALE', cap: 1 | 2 | 3) =>
  StudentService.registerStudent({
    full_name: `Test Resident ${phone.slice(-4)}`,
    phone_number: phone,
    gender,
    department: 'Computer Science',
    academic_level: '100 Level',
    preferred_occupancy: cap,
    roommate_mode: 'RANDOM',
    consent_random_matching: true,
    auto_complete_triple_consent: false,
  } as any);

describe('official NGN pricing schedule', () => {
  it('1: single = 240M kobo per resident', () => {
    expect(officialAmountKobo(1)).toBe(240000000);
    expect(OFFICIAL_NGN_KOBO[1]).toBe(240000000);
    expect(koboToNaira(240000000)).toBe(2400000);
  });
  it('2: double = 120M kobo per resident', () => {
    expect(officialAmountKobo(2)).toBe(120000000);
    expect(koboToNaira(120000000)).toBe(1200000);
  });
  it('3: triple = 80M kobo per resident', () => {
    expect(officialAmountKobo(3)).toBe(80000000);
    expect(koboToNaira(80000000)).toBe(800000);
  });
  it('formats per-resident NGN displays without USD fallback', () => {
    expect(formatOfficialPerResident(1)).toContain('2,400,000');
    expect(formatOfficialPerResident(2)).toContain('1,200,000');
    expect(formatOfficialPerResident(3)).toContain('800,000');
    expect(formatOfficialPerResident(1)).toMatch(/NGN.*per resident.*per academic session/i);
  });
  it('legacy USD never renders as NGN', () => {
    for (const a of [600, 800, 1200]) {
      const t = formatPaymentAmount(a, 'USD');
      expect(t).toContain('$');
      expect(t).toMatch(/DEMO/);
      expect(t).not.toContain('₦');
    }
  });
  it('rejects drifted official table values instead of creating wrong obligations', () => {
    expect(() => resolveOfficialPricing(1, 1200 as any)).toThrow(/drift/i);
  });
});

describe('new booking obligations use official NGN', () => {
  beforeEach(async () => { await runSeed(true); });

  it('single booking creates NGN 240M kobo obligation', () => {
    const reg = mkKnown('+2347000000011', 'MALE', 1);
    const s = reg.student as any;
    const g = reg.group;
    const pay = getDb().prepare('SELECT * FROM payments WHERE booking_group_id = ?').get(g.id) as any;
    expect(g.billing_currency).toBe('NGN');
    expect(pay.currency).toBe('NGN');
    expect(pay.amount).toBe(2400000);
    expect(pay.amount_kobo).toBe(240000000);
  });

  it('double booking creates NGN 120M kobo obligation', () => {
    const reg = mkKnown('+2347000000022', 'MALE', 2);
    const s = reg.student as any;
    const g = reg.group;
    const pay = getDb().prepare('SELECT * FROM payments WHERE booking_group_id = ?').get(g.id) as any;
    expect(pay.currency).toBe('NGN');
    expect(pay.amount_kobo).toBe(120000000);
    expect(pay.amount).toBe(1200000);
  });

  it('matching uses the identical official schedule', () => {
    mkRandom('+2347000000033', 'FEMALE', 2);
    mkRandom('+2347000000044', 'FEMALE', 2);
    const pays = getDb().prepare("SELECT * FROM payments WHERE currency = 'NGN' AND amount_kobo = 120000000").all() as any[];
    expect(pays.length).toBeGreaterThanOrEqual(2);
  });

  it('joining a legacy USD group does not convert it to NGN', () => {
    const db = getDb();
    // Seed a legacy-style USD FORMING double group (simulates pre-pricing history)
    const leader = mkKnown('+2347000000050', 'MALE', 2);
    const legacyGroupId = (leader.group as any).id;
    db.prepare("UPDATE booking_groups SET billing_currency = 'USD' WHERE id = ?").run(legacyGroupId);
    db.prepare("UPDATE payments SET currency = 'USD', amount = 800, amount_kobo = NULL WHERE booking_group_id = ?").run(legacyGroupId);
    const legacyGroup = db.prepare('SELECT * FROM booking_groups WHERE id = ?').get(legacyGroupId) as any;
    const hostelForLegacy = getDb().prepare('SELECT code FROM hostels WHERE id = ?').get(legacyGroup.hostel_id) as any;
    const newcomerReg = StudentService.registerStudent({ full_name: 'Test Resident 0055', phone_number: '+2347000000055', gender: hostelForLegacy.code, department: 'Computer Science', academic_level: '100 Level', preferred_occupancy: legacyGroup.target_capacity, roommate_mode: 'KNOWN', consent_random_matching: false, group_invite_code: legacyGroup.group_code, auto_complete_triple_consent: false } as any);
    const newcomer = newcomerReg.student as any;
    const joined = BookingGroupService.getGroupById(legacyGroup.id) as any;
    expect(joined.billing_currency).toBe('USD');
    const pay = db.prepare('SELECT * FROM payments WHERE student_id = ?').get((newcomer as any).id) as any;
    expect(pay.currency).toBe('USD');
    expect(pay.amount_kobo).toBeNull();
  });
});

describe('demo workflow with official NGN amounts', () => {
  beforeEach(async () => { await runSeed(true); });

  it('demo transfer records the correct NGN amount and reconciles with integer comparison', () => {
    const reg = mkKnown('+2347000000066', 'MALE', 1);
    const s = reg.student as any;
    // assign hold so instructions are available
    BookingGroupService.assignProvisionalHolds();
    const txn = PaymentService.simulateBankTransfer((s as any).phone_number);
    expect(txn.currency).toBe('NGN');
    expect(txn.amount).toBe(2400000);
    const reconciled = PaymentService.reconcileDemoTransaction(txn.id, 'admin-root-01');
    expect(reconciled.status).toBe('PENDING');
    expect(reconciled.reconciliation_status).toBe('RECONCILED');
  });

  it('demo reconciliation rejects mismatched amounts without float equality', () => {
    const reg = mkKnown('+2347000000077', 'MALE', 1);
    const s = reg.student as any;
    BookingGroupService.assignProvisionalHolds();
    const txn = PaymentService.simulateBankTransfer((s as any).phone_number);
    getDb().prepare('UPDATE demo_bank_transactions SET amount = amount + 1 WHERE id = ?').run(txn.id);
    expect(() => PaymentService.reconcileDemoTransaction(txn.id, 'admin-root-01')).toThrow(/amount/i);
    expect(amountsMatch({ amount: 2400000, amountKobo: 240000000, currency: 'NGN' }, { amount: 2400001, currency: 'NGN' })).toBe(false);
  });

  it('manager approval is still mandatory and allocation stays blocked before approval', async () => {
    const reg = mkKnown('+2347000000088', 'MALE', 1);
    const s = reg.student as any;
    const g = reg.group;
    BookingGroupService.assignProvisionalHolds();
    const txn = PaymentService.simulateBankTransfer((s as any).phone_number);
    PaymentService.reconcileDemoTransaction(txn.id, 'admin-root-01');
    const before = getDb().prepare('SELECT status FROM payments WHERE id = ?').get(txn.linked_payment_id) as any;
    expect(before.status).toBe('PENDING');
    await expect(AllocationService.finalizeGroupAllocation({ groupId: g.id, adminId: 'admin-root-01', accommodationStartDate: '2026-09-01' })).rejects.toThrow(/not yet verified/i);
    PaymentService.verifyPayment(txn.linked_payment_id, 'admin-root-01', 'bursary slip seen');
    const after = getDb().prepare('SELECT status FROM payments WHERE id = ?').get(txn.linked_payment_id) as any;
    expect(after.status).toBe('VERIFIED');
  });

  it('legacy USD payments remain intact with USD display', () => {
    const legacy = getDb().prepare("SELECT * FROM payments WHERE id = 'pay-demo-01'").get() as any;
    expect(legacy.amount).toBe(1200);
    expect(legacy.currency).toBe('USD');
    expect(legacy.amount_kobo).toBeNull();
    expect(formatPaymentAmount(legacy.amount, legacy.currency, legacy.amount_kobo)).toMatch(/USD.*DEMO/);
  });

  it('Monnify remains disabled', () => {
    expect(monnifyStatus().enabled).toBe(false);
  });
});
