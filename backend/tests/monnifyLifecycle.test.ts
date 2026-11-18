import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import { runSeed } from '../src/db/seed.js';
import { getDb } from '../src/db/connection.js';
import { createApp } from '../src/app.js';
import { SANDBOX_BASE_URL, LIVE_BASE_URL } from '../src/services/monnify/monnifyConfig.js';
import * as MP from '../src/services/monnify/monnifyPayments.js';
import { PaymentService } from '../src/services/paymentService.js';
import { AllocationService } from '../src/services/allocationService.js';
import { QRService } from '../src/services/qrService.js';
import { WhatsAppNotificationService } from '../src/services/whatsapp/whatsappNotifications.js';

const SYNTH_ENV = {
  MONNIFY_ENABLED: 'true',
  MONNIFY_MODE: 'sandbox',
  MONNIFY_BASE_URL: SANDBOX_BASE_URL,
  MONNIFY_API_KEY: 'SYNTH_API_KEY',
  MONNIFY_SECRET_KEY: 'SYNTH_WEBHOOK_SECRET_FOR_TESTS_ONLY',
  MONNIFY_CONTRACT_CODE: 'SYNTH_CONTRACT',
};
const SECRET = SYNTH_ENV.MONNIFY_SECRET_KEY;
let savedEnv: Record<string, string | undefined> = {};

function paidQueryResult(over: any = {}) {
  return {
    paymentReference: 'HX-REF', transactionReference: 'SYNTH-TX-1',
    paymentStatus: 'PAID', amountPaid: 2400000, totalPayable: 2400000,
    currency: 'NGN', paidOn: new Date().toISOString(), raw: {}, ...over,
  };
}

let txSeq = 0;
function makeFakeClient(queryImpl?: (kind: string, ref: string) => Promise<any>) {
  return {
    initTransaction: vi.fn(async (args: any) => {
      txSeq += 1;
      return { transactionReference: `SYNTH-TX-${txSeq}`, paymentReference: args.paymentReference, raw: {} };
    }),
    initDynamicAccount: vi.fn(async (args: any) => ({
      transactionReference: args.transactionReference, accountNumber: '5123456789',
      accountName: 'SYNTH RESIDENT ACCOUNT', bankName: 'SYNTH BANK', bankCode: '035',
      expiresOn: new Date(Date.now() + 2400 * 1000).toISOString(), amount: 2400000, raw: {},
    })),
    queryByPaymentReference: vi.fn(async (ref: string) =>
      queryImpl ? queryImpl('paymentReference', ref) : paidQueryResult({ paymentReference: ref })),
    queryByTransactionReference: vi.fn(async (ref: string) =>
      queryImpl ? queryImpl('transactionReference', ref) : paidQueryResult({ transactionReference: ref })),
  } as any;
}

let phoneSeq = 0;
function makeNgnFixture(capacity: 1 | 2 | 3, hostelId = 'hostel-male', gender = 'MALE') {
  const db = getDb();
  phoneSeq += 1;
  const phone = `+1555999${String(phoneSeq).padStart(4, '0')}`;
  const studentId = `stu-ngn-${crypto.randomUUID()}`;
  const groupId = `grp-ngn-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO students (id, full_name, phone_number, gender, department, academic_level, preferred_occupancy, roommate_mode, consent_random_matching, created_at, updated_at)
    VALUES (?, 'NGN Test Resident', ?, ?, 'Engineering', '100', ?, 'KNOWN', 0, ?, ?)`)
    .run(studentId, phone, gender, capacity, now, now);
  db.prepare(`INSERT INTO booking_groups (id, group_code, hostel_id, target_capacity, status, created_by_student_id, billing_currency, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'FORMING', ?, 'NGN', ?, ?)`)
    .run(groupId, `NGN-${crypto.randomBytes(3).toString('hex').toUpperCase()}`, hostelId, capacity, studentId, now, now);
  db.prepare(`INSERT INTO booking_group_members (id, group_id, student_id, role, is_matched_from_queue, joined_at)
    VALUES (?, ?, ?, 'LEADER', 0, ?)`).run(`bgm-${crypto.randomUUID()}`, groupId, studentId, now);
  const payment = MP.createNgnObligation({ studentId, bookingGroupId: groupId, capacity });
  return { studentId, groupId, phone, payment };
}

function signPayload(raw: string): string {
  return crypto.createHmac('sha512', SECRET).update(Buffer.from(raw, 'utf8')).digest('hex');
}

beforeEach(async () => {
  await runSeed(true);
  savedEnv = {};
  for (const k of [...Object.keys(SYNTH_ENV), 'NODE_ENV']) { savedEnv[k] = process.env[k]; }
  Object.assign(process.env, SYNTH_ENV);
  process.env.NODE_ENV = 'test';
  MP.resetMonnifyClientOverride();
});

afterEach(() => {
  MP.resetMonnifyClientOverride();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('monnify NGN obligation creation and pricing', () => {
  it.each([[1, 240000000], [2, 120000000], [3, 80000000]])(
    'creates a capacity-%i obligation at %i kobo per academic session', (capacity, kobo) => {
      const f = makeNgnFixture(capacity as 1 | 2 | 3);
      expect(f.payment.currency).toBe('NGN');
      expect(f.payment.amount_kobo).toBe(kobo);
      expect(f.payment.amount).toBe(kobo / 100);
      expect(f.payment.provider).toBe('MONNIFY');
      expect(f.payment.status).toBe('PENDING');
    },
  );

  it('rejects duplicate obligations and currency mixing', () => {
    const f = makeNgnFixture(2);
    expect(() => MP.createNgnObligation({ studentId: f.studentId, bookingGroupId: f.groupId, capacity: 2 }))
      .toThrow(/already exists/i);
    const db = getDb();
    const legacy = db.prepare(`SELECT * FROM payments WHERE currency = 'USD' LIMIT 1`).get() as any;
    expect(() => MP.createNgnObligation({ studentId: legacy.student_id, bookingGroupId: legacy.booking_group_id, capacity: 1 }))
      .toThrow(/already exists|mixing/i);
  });

  it('refuses NGN obligations inside a legacy USD group', () => {
    const db = getDb();
    const usdGroup = db.prepare(`SELECT * FROM booking_groups WHERE billing_currency = 'USD' LIMIT 1`).get() as any;
    const outsider = `stu-out-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    phoneSeq += 1;
    db.prepare(`INSERT INTO students (id, full_name, phone_number, gender, department, academic_level, preferred_occupancy, roommate_mode, consent_random_matching, created_at, updated_at)
      VALUES (?, 'Outsider', ?, 'MALE', 'Engineering', '100', 1, 'KNOWN', 0, ?, ?)`).run(outsider, `+1555888${phoneSeq}`, now, now);
    expect(() => MP.createNgnObligation({ studentId: outsider, bookingGroupId: usdGroup.id, capacity: 1 }))
      .toThrow(/mixing/i);
  });
});

describe('monnify attempt issuance (mocked provider)', () => {
  it('issues a dynamic virtual account and converts kobo to naira at the boundary', async () => {
    const f = makeNgnFixture(1);
    const fake = makeFakeClient();
    MP.setMonnifyClientOverride(fake);
    const attempt = await MP.initiateAttempt({ paymentId: f.payment.id });
    expect(fake.initTransaction).toHaveBeenCalledTimes(1);
    expect(fake.initTransaction.mock.calls[0][0].amountKobo).toBe(240000000);
    expect(fake.initDynamicAccount.mock.calls[0][0].transactionReference).toBe('SYNTH-TX-1');
    expect(attempt.account_number).toBe('5123456789');
    expect(attempt.bank_name).toBe('SYNTH BANK');
    expect(attempt.account_expires_at).toBeTruthy();
    expect(attempt.status).toBe('PENDING');
    expect(attempt.merchant_reference).toBeTruthy();
  });

  it('reuses a live attempt but creates a new one after expiry', async () => {
    const f = makeNgnFixture(3);
    MP.setMonnifyClientOverride(makeFakeClient());
    const a1 = await MP.initiateAttempt({ paymentId: f.payment.id });
    const again = await MP.initiateAttempt({ paymentId: f.payment.id });
    expect(again.id).toBe(a1.id);
    getDb().prepare(`UPDATE payment_attempts SET account_expires_at = ? WHERE id = ?`)
      .run(new Date(Date.now() - 1000).toISOString(), a1.id);
    const a2 = await MP.initiateAttempt({ paymentId: f.payment.id });
    expect(a2.id).not.toBe(a1.id);
    expect(getDb().prepare('SELECT status FROM payment_attempts WHERE id = ?').get(a1.id) as any).toMatchObject({ status: 'SUPERSEDED' });
  });

  it('refuses to reinitialize an already verified payment', async () => {
    const f = makeNgnFixture(2);
    MP.setMonnifyClientOverride(makeFakeClient((_k, _r) => paidQueryResult({ amountPaid: 1200000, totalPayable: 1200000 })));
    await MP.initiateAttempt({ paymentId: f.payment.id });
    const mref = (getDb().prepare('SELECT merchant_reference as m FROM payment_attempts WHERE payment_id = ?').get(f.payment.id) as any).m;
    await MP.queryAndReconcile({ merchantReference: mref });
    PaymentService.verifyPayment(f.payment.id, 'admin-root-01', 'manager ok');
    await expect(MP.initiateAttempt({ paymentId: f.payment.id })).rejects.toThrow(/already verified/i);
  });
});

describe('monnify webhook and reconciliation (mocked provider)', () => {
  async function initiate(f: any, queryImpl?: (kind: string, ref: string) => Promise<any>) {
    MP.setMonnifyClientOverride(makeFakeClient(queryImpl));
    return MP.initiateAttempt({ paymentId: f.payment.id });
  }

  it('accepts a sandbox unsigned webhook as a trigger, reconciles server-side, and keeps payment PENDING', async () => {
    const f = makeNgnFixture(1);
    const attempt = await initiate(f);
    const raw = JSON.stringify({ paymentReference: attempt.merchant_reference, transactionReference: 'SYNTH-TX-1' });
    const res = await MP.handleMonnifyWebhook({ rawBody: Buffer.from(raw, 'utf8') });
    expect(res.status).toBe('RECONCILED');
    const payment = getDb().prepare('SELECT * FROM payments WHERE id = ?').get(f.payment.id) as any;
    expect(payment.status).toBe('PENDING');
    expect(payment.reconciliation_status).toBe('RECONCILED');
    expect(payment.verified_by_admin_id).toBeNull();
  });

  it('handles duplicate webhook delivery idempotently', async () => {
    const f = makeNgnFixture(1);
    MP.setMonnifyClientOverride(makeFakeClient());
    const attempt = await MP.initiateAttempt({ paymentId: f.payment.id });
    const raw = JSON.stringify({ paymentReference: attempt.merchant_reference, transactionReference: 'SYNTH-TX-1' });
    const first = await MP.handleMonnifyWebhook({ rawBody: Buffer.from(raw, 'utf8') });
    const second = await MP.handleMonnifyWebhook({ rawBody: Buffer.from(raw, 'utf8') });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(getDb().prepare('SELECT COUNT(*) as n FROM payment_attempts WHERE payment_id = ?').get(f.payment.id) as any).toMatchObject({ n: 1 });
  });

  it('records a forged sandbox webhook as a failed event when provider verification fails', async () => {
    MP.setMonnifyClientOverride(makeFakeClient(async () => { throw new Error('Transaction not found'); }));
    const raw = JSON.stringify({ paymentReference: 'HX-FORGED-1', transactionReference: 'TX-FORGED-1' });
    await expect(MP.handleMonnifyWebhook({ rawBody: Buffer.from(raw, 'utf8') })).rejects.toThrow(/no matching|no record/i);
    const ev = getDb().prepare('SELECT * FROM monnify_webhook_events ORDER BY created_at DESC LIMIT 1').get() as any;
    expect(ev.processing_status).toBe('FAILED');
  });

  it('recovers a persisted FAILED webhook event after a simulated restart', async () => {
    const f = makeNgnFixture(1);
    let fail = true;
    MP.setMonnifyClientOverride(makeFakeClient(async () => {
      if (fail) throw new Error('Monnify request timed out.');
      return paidQueryResult({});
    }));
    const attempt = await MP.initiateAttempt({ paymentId: f.payment.id });
    const raw = JSON.stringify({ paymentReference: attempt.merchant_reference, transactionReference: 'SYNTH-TX-1' });
    await expect(MP.handleMonnifyWebhook({ rawBody: Buffer.from(raw, 'utf8') })).rejects.toThrow(/temporarily unavailable|timed out/i);
    fail = false;
    const res = await MP.handleMonnifyWebhook({ rawBody: Buffer.from(raw, 'utf8') });
    expect(res.status).toBe('RECONCILED');
    expect(getDb().prepare('SELECT processing_status FROM monnify_webhook_events LIMIT 1').get() as any).toMatchObject({ processing_status: 'PROCESSED' });
  });

  it('flags underpayment and overpayment as mismatches without unlocking anything', async () => {
    for (const [paid, word] of [[2399999, 'Underpayment'], [2400001, 'Overpayment']] as const) {
      const f = makeNgnFixture(1);
      await initiate(f, async () => paidQueryResult({ amountPaid: paid, totalPayable: 2400000 }));
      const attempt = getDb().prepare('SELECT * FROM payment_attempts WHERE payment_id = ?').get(f.payment.id) as any;
      const out = await MP.queryAndReconcile({ merchantReference: attempt.merchant_reference });
      expect(out.status).toBe('MISMATCH');
      expect(JSON.stringify(out.provider_metadata)).toContain(word);
      const payment = getDb().prepare('SELECT * FROM payments WHERE id = ?').get(f.payment.id) as any;
      expect(payment.status).toBe('PENDING');
      expect(payment.reconciliation_status).toBe('EXCEPTION');
      expect(() => PaymentService.verifyPayment(f.payment.id, 'admin-root-01')).toThrow(/provider verification/i);
    }
  });

  it('flags wrong currency and unknown references', async () => {
    const f = makeNgnFixture(1);
    await initiate(f, async () => paidQueryResult({ currency: 'USD', amountPaid: 2400000 }));
    const attempt = getDb().prepare('SELECT * FROM payment_attempts WHERE payment_id = ?').get(f.payment.id) as any;
    expect((await MP.queryAndReconcile({ merchantReference: attempt.merchant_reference })).status).toBe('MISMATCH');
    await expect(MP.queryAndReconcile({ merchantReference: 'HX-DOES-NOT-EXIST' })).rejects.toThrow(/unknown transaction/i);
    const raw = JSON.stringify({ nope: true });
    await expect(MP.handleMonnifyWebhook({ rawBody: Buffer.from(raw, 'utf8') })).rejects.toThrow(/no payment or transaction reference/i);
  });

  it('keeps the attempt pending on provider timeout and succeeds on retry', async () => {
    const f = makeNgnFixture(2);
    let calls = 0;
    MP.setMonnifyClientOverride(makeFakeClient(async () => {
      calls += 1;
      if (calls === 1) throw new Error('Monnify request timed out.');
      return paidQueryResult({ amountPaid: 1200000, totalPayable: 1200000 });
    }));
    const attempt = await MP.initiateAttempt({ paymentId: f.payment.id });
    await expect(MP.queryAndReconcile({ merchantReference: attempt.merchant_reference })).rejects.toThrow(/query failed/i);
    expect((getDb().prepare('SELECT * FROM payment_attempts WHERE id = ?').get(attempt.id) as any).status).toBe('PENDING');
    const retry = await MP.queryAndReconcile({ merchantReference: attempt.merchant_reference });
    expect(retry.status).toBe('RECONCILED');
  });

  it('maps expired, failed and reversed provider outcomes without verifying', async () => {
    for (const providerStatus of ['EXPIRED', 'FAILED', 'REVERSED']) {
      const f = makeNgnFixture(3);
      await initiate(f, async () => paidQueryResult({ paymentStatus: providerStatus, amountPaid: 0 }));
      const attempt = getDb().prepare('SELECT * FROM payment_attempts WHERE payment_id = ?').get(f.payment.id) as any;
      const out = await MP.queryAndReconcile({ merchantReference: attempt.merchant_reference });
      expect(out.status).toBe(providerStatus);
      expect((getDb().prepare('SELECT * FROM payments WHERE id = ?').get(f.payment.id) as any).status).toBe('PENDING');
    }
  });
});

describe('monnify production webhook security', () => {
  beforeEach(() => {
    process.env.MONNIFY_MODE = 'live';
    process.env.MONNIFY_BASE_URL = LIVE_BASE_URL;
  });

  it('rejects a missing signature in production', async () => {
    MP.setMonnifyClientOverride(makeFakeClient());
    const raw = JSON.stringify({ paymentReference: 'HX-X', transactionReference: 'TX-X' });
    await expect(MP.handleMonnifyWebhook({ rawBody: Buffer.from(raw, 'utf8') })).rejects.toThrow(/missing monnify-signature/i);
  });

  it('rejects an invalid signature in production', async () => {
    MP.setMonnifyClientOverride(makeFakeClient());
    const raw = JSON.stringify({ paymentReference: 'HX-X', transactionReference: 'TX-X' });
    await expect(MP.handleMonnifyWebhook({ rawBody: Buffer.from(raw, 'utf8'), signatureHeader: 'deadbeef' }))
      .rejects.toThrow(/invalid webhook signature/i);
  });

  it('accepts a valid HMAC-SHA512 signature in production and still keeps payment PENDING', async () => {
    const f = makeNgnFixture(1);
    MP.setMonnifyClientOverride(makeFakeClient());
    const attempt = await MP.initiateAttempt({ paymentId: f.payment.id });
    const raw = JSON.stringify({ paymentReference: attempt.merchant_reference, transactionReference: 'SYNTH-TX-1' });
    const res = await MP.handleMonnifyWebhook({ rawBody: Buffer.from(raw, 'utf8'), signatureHeader: signPayload(raw) });
    expect(res.status).toBe('RECONCILED');
    expect((getDb().prepare('SELECT * FROM payments WHERE id = ?').get(f.payment.id) as any).status).toBe('PENDING');
  });
});

describe('monnify manager approval invariant', () => {
  it('blocks manager approval before provider verification and allows it after', async () => {
    const f = makeNgnFixture(1);
    MP.setMonnifyClientOverride(makeFakeClient());
    const attempt = await MP.initiateAttempt({ paymentId: f.payment.id });
    expect(() => PaymentService.verifyPayment(f.payment.id, 'admin-root-01')).toThrow(/provider verification/i);
    await MP.queryAndReconcile({ merchantReference: attempt.merchant_reference });
    const approved = PaymentService.verifyPayment(f.payment.id, 'admin-root-01', 'Manager confirmed reconciled NGN payment');
    expect(approved.status).toBe('VERIFIED');
  });

  it('blocks final allocation and QR eligibility until manager approval', async () => {
    const f = makeNgnFixture(1);
    MP.setMonnifyClientOverride(makeFakeClient());
    getDb().prepare(`UPDATE booking_groups SET status = 'READY_FOR_ALLOCATION' WHERE id = ?`).run(f.groupId);
    await MP.initiateAttempt({ paymentId: f.payment.id });
    const attempt = getDb().prepare('SELECT * FROM payment_attempts WHERE payment_id = ?').get(f.payment.id) as any;
    await MP.queryAndReconcile({ merchantReference: attempt.merchant_reference });
    await expect(AllocationService.finalizeGroupAllocation({ groupId: f.groupId, adminId: 'admin-root-01', accommodationStartDate: '2026-09-01' }))
      .rejects.toThrow(/not yet verified/i);
    expect(QRService.getEligibility(f.studentId).eligible).toBe(false);
    PaymentService.verifyPayment(f.payment.id, 'admin-root-01', 'ok');
    expect(QRService.getEligibility(f.studentId).eligible).toBe(false);
  });
});

describe('monnify legacy preservation and notifications', () => {
  it('keeps legacy USD payments intact and demo-bank reconciliation working', async () => {
    const legacy = getDb().prepare(`SELECT * FROM payments WHERE id = 'pay-demo-01'`).get() as any;
    expect(legacy.currency).toBe('USD');
    expect(legacy.amount).toBe(1200);
    expect(legacy.status).toBe('VERIFIED');
    getDb().prepare(`UPDATE payments SET status = 'PENDING', verified_by_admin_id = NULL, verified_at = NULL WHERE id = 'pay-demo-04'`).run();
    const txn = PaymentService.simulateBankTransfer('+15553003001');
    expect(txn.provider_type).toBe('DEMO_BANK');
    const reconciled = PaymentService.reconcileDemoTransaction(txn.id, 'admin-root-01');
    expect(reconciled.status).toBe('PENDING');
    expect(reconciled.reconciliation_status).toBe('RECONCILED');
  });

  it('deduplicates WhatsApp approval notifications', () => {
    const first = WhatsAppNotificationService.queueAndSend({
      dedupeKey: 'test-dedupe-monnify-1', studentId: 'stu-demo-01',
      phone: '+15551001001', kind: 'PAYMENT_APPROVED', bodyText: 'hello',
    });
    const second = WhatsAppNotificationService.queueAndSend({
      dedupeKey: 'test-dedupe-monnify-1', studentId: 'stu-demo-01',
      phone: '+15551001001', kind: 'PAYMENT_APPROVED', bodyText: 'hello',
    });
    expect(second.notificationId).toBe(first.notificationId);
    expect(getDb().prepare(`SELECT COUNT(*) as n FROM whatsapp_notifications WHERE dedupe_key = 'test-dedupe-monnify-1'`).get() as any).toMatchObject({ n: 1 });
  });

  it('returns NGN transfer details to the resident over the existing WhatsApp flow', async () => {
    const { ConversationHandler } = await import('../src/services/whatsapp/conversationHandler.js');
    const f = makeNgnFixture(2);
    MP.setMonnifyClientOverride(makeFakeClient());
    const sent: string[] = [];
    const payment = { ...(getDb().prepare('SELECT * FROM payments WHERE id = ?').get(f.payment.id) as any), full_name: 'NGN Test Resident' };
    await ConversationHandler.handleMonnifyInstructions(f.phone, payment, { sendTextMessage: async (_p: string, t: string) => { sent.push(t); } });
    expect(sent.length).toBe(1);
    expect(sent[0]).toContain('5123456789');
    expect(sent[0]).toContain('SYNTH BANK');
    expect(sent[0]).toContain('HX-');
    expect(sent[0]).toContain('₦');
    expect(sent[0]).toMatch(/PENDING until the manager/i);
    expect(sent[0]).not.toMatch(/approved/i);
  });
});

describe('monnify HTTP authorization', () => {
  function mockReqRes(token?: string, role?: string) {
    const req: any = { headers: token ? { authorization: `Bearer ${token}` } : {}, admin: role ? { id: 'x', username: 'u', full_name: 'U', email: 'e', role, must_change_password: false } : undefined };
    const res: any = { statusCode: 200, body: undefined };
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: any) => { res.body = b; return res; };
    return { req, res };
  }

  it('protects manager endpoints with authentication and the MANAGER role', async () => {
    const { authMiddleware, requireManager } = await import('../src/middleware/authMiddleware.js');
    const { sign } = await import('jsonwebtoken').then((m) => ({ sign: (m as any).default.sign }));
    const { config } = await import('../src/config.js');
    const managerToken = (sign as any)({ id: 'admin-root-01', username: 'admin', role: 'MANAGER' }, config.jwtSecret, { expiresIn: '1h' });
    const secDb = getDb();
    const { default: bcrypt2 } = await import('bcryptjs');
    if (!(secDb.prepare('SELECT id FROM admin_users WHERE id = ?').get('sec-monnify-01') as any)) {
      const hash = await bcrypt2.hash('SecurityPass12345678!', 10);
      secDb.prepare(`INSERT INTO admin_users (id, username, password_hash, full_name, email, role, is_active, created_at)
        VALUES ('sec-monnify-01', 'sec.monnify', ?, 'Sec Monnify', 'sec@hostel.local', 'SECURITY', 1, datetime('now'))`).run(hash);
    }
    const secToken = (sign as any)({ id: 'sec-monnify-01', username: 'sec.monnify', role: 'SECURITY' }, config.jwtSecret, { expiresIn: '1h' });

    // No token -> 401 from authMiddleware.
    {
      const { req, res } = mockReqRes();
      let nexted = false;
      authMiddleware(req, res, () => { nexted = true; });
      expect(nexted).toBe(false);
      expect(res.statusCode).toBe(401);
    }
    // SECURITY token authenticates but requireManager rejects with 403.
    {
      const { req, res } = mockReqRes(secToken);
      let nexted = false;
      authMiddleware(req, res, () => { nexted = true; });
      expect(nexted).toBe(true);
      expect(req.admin.role).toBe('SECURITY');
      const res2: any = { statusCode: 200 };
      res2.status = (c: number) => { res2.statusCode = c; return res2; };
      res2.json = (b: any) => { res2.body = b; return res2; };
      let managerNexted = false;
      requireManager(req, res2, () => { managerNexted = true; });
      expect(managerNexted).toBe(false);
      expect(res2.statusCode).toBe(403);
    }
    // MANAGER token passes both gates.
    {
      const { req, res } = mockReqRes(managerToken);
      let nexted = false;
      authMiddleware(req, res, () => { nexted = true; });
      expect(nexted).toBe(true);
      let managerNexted = false;
      requireManager(req, res, () => { managerNexted = true; });
      expect(managerNexted).toBe(true);
    }
  });

  it('mounts manager and webhook routers without leaking secrets in status', async () => {
    const app = createApp();
    const paths: string[] = [];
    const stack: any[] = (app as any)._router?.stack || [];
    for (const layer of stack) {
      if (layer.route?.path) paths.push(layer.route.path);
      else if (layer.name === 'router' && layer.handle?.stack) {
        for (const sub of layer.handle.stack) {
          if (sub.route) {
            const mount = layer.regexp?.toString() || '';
            paths.push(`${mount} ${Object.keys(sub.route.methods).join(',')} ${sub.route.path}`);
          }
        }
      }
    }
    const dump = paths.join('\n');
    expect(dump).toMatch(/monnify/);
    expect(dump).toMatch(/webhooks/);
    const st = MP.monnifyStatus();
    expect(st.enabled).toBe(true);
    expect(JSON.stringify(st)).not.toMatch(/SYNTH_API_KEY|SYNTH_WEBHOOK_SECRET/);
  });

  it('runs the manager initiate and reconcile flow at the service layer', async () => {
    const f = makeNgnFixture(1);
    MP.setMonnifyClientOverride(makeFakeClient());
    const created = await MP.initiateAttempt({ paymentId: f.payment.id, adminId: 'admin-root-01' });
    expect(created.account_number).toBe('5123456789');
    expect(MP.getAttempts(f.payment.id).length).toBeGreaterThanOrEqual(1);
    const rec = await MP.queryAndReconcile({ merchantReference: created.merchant_reference, adminId: 'admin-root-01' });
    expect(rec.status).toBe('RECONCILED');
    expect((getDb().prepare('SELECT * FROM payments WHERE id = ?').get(f.payment.id) as any).status).toBe('PENDING');
  });
});
