import crypto from 'crypto';
import { getDb } from '../../db/connection.js';
import { getMonnifyConfig, assertMonnifyUsable, MAX_TIMEOUT_SECONDS } from './monnifyConfig.js';
import { MonnifyClient, MonnifyError } from './monnifyClient.js';
import { officialAmountKobo, koboToNaira } from './pricing.js';
import { AuditService } from '../auditService.js';

let clientOverride: MonnifyClient | null = null;
export function setMonnifyClientOverride(client: MonnifyClient | null) { clientOverride = client; }
export function resetMonnifyClientOverride() { clientOverride = null; }
function activeClient(): MonnifyClient { return clientOverride ?? new MonnifyClient(); }

export function monnifyStatus(): { enabled: boolean; mode: string } {
  try {
    const cfg = getMonnifyConfig();
    if (!cfg.enabled) return { enabled: false, mode: cfg.mode };
    assertMonnifyUsable(cfg);
    return { enabled: true, mode: cfg.mode };
  } catch {
    return { enabled: false, mode: 'disabled' };
  }
}

function requireEnabled() {
  return assertMonnifyUsable(getMonnifyConfig());
}

function uniqueRef(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
}

function toKoboFromNaira(naira: unknown): number | null {
  const n = Number(naira);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function expiryOrDefault(expiresOn?: string | null): string {
  if (expiresOn && String(expiresOn).trim()) return String(expiresOn);
  return new Date(Date.now() + MAX_TIMEOUT_SECONDS * 1000).toISOString();
}

function isAttemptLive(status: string, expiresAt?: string | null): boolean {
  if (status !== 'PENDING') return false;
  if (!expiresAt) return true;
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return true;
  return t > Date.now();
}

function pickRef(obj: any, ...keys: string[]): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    const v = (obj as any)[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  const data = (obj as any).responseBody ?? (obj as any).data ?? (obj as any).eventData;
  if (data && data !== obj) return pickRef(data, ...keys);
  return undefined;
}

export function createNgnObligation(params: { studentId: string; bookingGroupId: string; capacity: 1 | 2 | 3 }): any {
  const db = getDb();
  const group = db.prepare('SELECT * FROM booking_groups WHERE id = ?').get(params.bookingGroupId) as any;
  if (!group) throw new Error('Booking group not found.');
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(params.studentId) as any;
  if (!student) throw new Error('Student not found.');
  if (group.target_capacity !== params.capacity) throw new Error('Capacity does not match the booking group.');
  const existing = db.prepare('SELECT * FROM payments WHERE student_id = ? AND booking_group_id = ?').get(params.studentId, params.bookingGroupId) as any;
  if (existing) throw new Error('A payment obligation already exists for this resident in this group.');
  const others = db.prepare('SELECT * FROM payments WHERE booking_group_id = ?').all(params.bookingGroupId) as any[];
  for (const o of others) {
    if (o.currency !== 'NGN') throw new Error('Currency mixing is not allowed: this group already has non-NGN obligations.');
  }
  const amountKobo = officialAmountKobo(params.capacity);
  const amountNaira = koboToNaira(amountKobo);
  const now = new Date().toISOString();
  const id = `pay-${crypto.randomUUID()}`;
  const refCode = uniqueRef('NGN');
  db.transaction(() => {
    db.prepare(`INSERT INTO payments (id, student_id, booking_group_id, amount, currency, status, reference_code, amount_kobo, provider, reconciliation_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'NGN', 'PENDING', ?, ?, 'MONNIFY', 'NOT_SUBMITTED', ?, ?)`)
      .run(id, params.studentId, params.bookingGroupId, amountNaira, refCode, amountKobo, now, now);
    db.prepare('UPDATE booking_groups SET billing_currency = ?, updated_at = ? WHERE id = ?').run('NGN', now, params.bookingGroupId);
  })();
  return db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
}

export function getAttempts(paymentId?: string): any[] {
  const db = getDb();
  if (paymentId) {
    return db.prepare(`SELECT a.*, p.reference_code as obligation_reference, p.student_id, s.full_name as student_name
      FROM payment_attempts a JOIN payments p ON p.id = a.payment_id LEFT JOIN students s ON s.id = p.student_id
      WHERE a.payment_id = ? ORDER BY a.created_at DESC`).all(paymentId);
  }
  return db.prepare(`SELECT a.*, p.reference_code as obligation_reference, p.student_id, s.full_name as student_name
    FROM payment_attempts a JOIN payments p ON p.id = a.payment_id LEFT JOIN students s ON s.id = p.student_id
    ORDER BY a.created_at DESC LIMIT 200`).all();
}

export function getActiveAttempt(paymentId: string): any | null {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM payment_attempts WHERE payment_id = ? ORDER BY created_at DESC`).all(paymentId) as any[];
  for (const r of rows) {
    if (isAttemptLive(r.status, r.account_expires_at)) return r;
  }
  return null;
}

export async function initiateAttempt(params: { paymentId: string; bankCode?: string; adminId?: string }): Promise<any> {
  const cfg = requireEnabled();
  const db = getDb();
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(params.paymentId) as any;
  if (!payment) throw new Error('Payment obligation not found.');
  if (payment.status === 'VERIFIED') throw new Error('This payment is already verified and cannot be reinitialized.');
  if (payment.status !== 'PENDING') throw new Error('Only pending payments can initiate a Monnify transfer.');
  if (payment.currency !== 'NGN' || payment.amount_kobo == null) throw new Error('Only official NGN obligations can use Monnify.');
  const group = db.prepare('SELECT * FROM booking_groups WHERE id = ?').get(payment.booking_group_id) as any;
  if (group && group.billing_currency && group.billing_currency !== 'NGN') throw new Error('Currency mixing is not allowed inside a booking group.');
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(payment.student_id) as any;
  if (!student) throw new Error('Student not found.');
  const live = getActiveAttempt(payment.id);
  if (live) return live;

  const merchantReference = uniqueRef('HX');
  const idempotencyKey = `monnify:${merchantReference}`;
  const digits = String(student.phone_number || '').replace(/[^0-9]/g, '') || 'unknown';
  const customerEmail = `${digits}@hostelos.local`;
  const client = activeClient();
  let initRes;
  try {
    initRes = await client.initTransaction({
      amountKobo: payment.amount_kobo,
      paymentReference: merchantReference,
      customerName: student.full_name,
      customerEmail,
      paymentDescription: `HostelOS accommodation per academic session (${payment.reference_code})`,
      cfgOverride: cfg,
    });
  } catch (err: any) {
    throw new Error(`Monnify transaction initialization failed: ${err?.message || 'provider error'}`);
  }
  let dyn;
  try {
    dyn = await client.initDynamicAccount({ transactionReference: initRes.transactionReference, bankCode: params.bankCode, cfgOverride: cfg });
  } catch (err: any) {
    throw new Error(`Monnify dynamic account failed: ${err?.message || 'provider error'}`);
  }
  const now = new Date().toISOString();
  const id = `att-${crypto.randomUUID()}`;
  const expiresAt = expiryOrDefault(dyn.expiresOn);
  db.transaction(() => {
    db.prepare(`UPDATE payment_attempts SET status = 'SUPERSEDED', updated_at = ? WHERE payment_id = ? AND status = 'PENDING'`).run(now, payment.id);
    db.prepare(`INSERT INTO payment_attempts (id, payment_id, provider, merchant_reference, monnify_transaction_reference, amount_kobo, currency, account_number, bank_name, account_name, account_expires_at, status, provider_metadata, idempotency_key, created_at, updated_at)
      VALUES (?, ?, 'MONNIFY', ?, ?, ?, 'NGN', ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)`)
      .run(id, payment.id, merchantReference, initRes.transactionReference, payment.amount_kobo,
        dyn.accountNumber || null, dyn.bankName || null, dyn.accountName || null, expiresAt,
        JSON.stringify({ initiatedBy: params.adminId || 'resident', raw: undefined }), idempotencyKey, now, now);
    db.prepare(`UPDATE payments SET reconciliation_status = 'AWAITING_RECONCILIATION', updated_at = ? WHERE id = ?`).run(now, payment.id);
  })();
  try {
    AuditService.log({ adminId: params.adminId, action: 'MONNIFY_ATTEMPT_INITIATED', entityType: 'PAYMENT', entityId: payment.id, newValues: { merchantReference, transactionReference: initRes.transactionReference }, notes: `Monnify attempt for ${payment.reference_code}` });
  } catch { /* audit must not break initiation */ }
  return db.prepare('SELECT * FROM payment_attempts WHERE id = ?').get(id);
}

export async function queryAndReconcile(params: { merchantReference?: string; transactionReference?: string; adminId?: string }): Promise<any> {
  const cfg = requireEnabled();
  const db = getDb();
  let attempt: any = null;
  if (params.merchantReference) {
    attempt = db.prepare('SELECT * FROM payment_attempts WHERE merchant_reference = ?').get(params.merchantReference);
  } else if (params.transactionReference) {
    attempt = db.prepare('SELECT * FROM payment_attempts WHERE monnify_transaction_reference = ?').get(params.transactionReference);
  }
  if (!attempt) {
    throw new Error('Unknown transaction reference: no matching HostelOS attempt.');
  }
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(attempt.payment_id) as any;
  if (!payment) throw new Error('Linked payment obligation not found.');
  const client = activeClient();
  let result;
  try {
    result = params.transactionReference
      ? await client.queryByTransactionReference(params.transactionReference, cfg)
      : await client.queryByPaymentReference(params.merchantReference!, cfg);
  } catch (err: any) {
    if (err instanceof MonnifyError && err.status && err.status >= 500) {
      throw new Error(`Monnify provider is temporarily unavailable (status ${err.status}). The attempt stays pending for retry.`);
    }
    if (err instanceof MonnifyError && (err.status === 404 || /not found/i.test(err.message))) {
      recordMismatch(attempt, payment, 'WRONG_REFERENCE', `Provider has no record for this reference.`, params.adminId);
      throw new Error('Provider has no record for this reference.');
    }
    throw new Error(`Monnify query failed: ${err?.message || 'provider error'}`);
  }
  const status = String(result.paymentStatus || 'UNKNOWN').toUpperCase();
  const currency = String(result.currency || '').toUpperCase();
  const paidKobo = toKoboFromNaira(result.amountPaid);
  const now = new Date().toISOString();

  if (status === 'PAID' || status === 'SUCCESS' || status === 'SUCCESSFUL') {
    if (currency !== 'NGN') return recordMismatch(attempt, payment, 'WRONG_CURRENCY', `Provider currency ${currency} is not NGN.`, params.adminId);
    if (paidKobo == null) return recordMismatch(attempt, payment, 'AMOUNT_MISMATCH', 'Provider amount is unreadable.', params.adminId);
    if (paidKobo !== attempt.amount_kobo) {
      const reason = paidKobo < attempt.amount_kobo ? 'Underpayment: amount paid is less than expected.' : 'Overpayment: amount paid exceeds expected.';
      return recordMismatch(attempt, payment, paidKobo < attempt.amount_kobo ? 'UNDERPAID' : 'OVERPAID', `${reason} Expected ${attempt.amount_kobo} kobo, provider reports ${paidKobo} kobo.`, params.adminId);
    }
    const late = attempt.account_expires_at ? new Date(attempt.account_expires_at).getTime() < Date.now() : false;
    db.transaction(() => {
      db.prepare(`UPDATE payment_attempts SET status = 'RECONCILED', paid_at = ?, provider_metadata = ?, updated_at = ? WHERE id = ?`)
        .run(result.paidOn || now, JSON.stringify({ providerStatus: status, paidKobo, currency, late, reconciledAt: now }), now, attempt.id);
      db.prepare(`UPDATE payments SET reconciliation_status = 'RECONCILED', updated_at = ? WHERE id = ?`).run(now, payment.id);
    })();
    try {
      AuditService.log({ adminId: params.adminId, action: 'MONNIFY_ATTEMPT_RECONCILED', entityType: 'PAYMENT', entityId: payment.id, newValues: { merchantReference: attempt.merchant_reference, late }, notes: late ? 'Late but exact provider payment; manager approval still required.' : 'Exact provider payment confirmed; manager approval still required.' });
    } catch { /* ignore */ }
    return db.prepare('SELECT * FROM payment_attempts WHERE id = ?').get(attempt.id);
  }
  if (status === 'PENDING' || status === 'INITIATED' || status === 'AWAITING_PAYMENT') {
    db.prepare(`UPDATE payment_attempts SET provider_metadata = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify({ providerStatus: status, lastCheckedAt: now, paidKobo, currency }), now, attempt.id);
    return db.prepare('SELECT * FROM payment_attempts WHERE id = ?').get(attempt.id);
  }
  if (status === 'EXPIRED') {
    db.transaction(() => {
      db.prepare(`UPDATE payment_attempts SET status = 'EXPIRED', provider_metadata = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify({ providerStatus: status }), now, attempt.id);
      db.prepare(`UPDATE payments SET reconciliation_status = 'EXCEPTION', updated_at = ? WHERE id = ?`).run(now, payment.id);
    })();
    return db.prepare('SELECT * FROM payment_attempts WHERE id = ?').get(attempt.id);
  }
  if (status === 'REVERSED' || status === 'REFUNDED' || status === 'REVERAL') {
    db.transaction(() => {
      db.prepare(`UPDATE payment_attempts SET status = 'REVERSED', provider_metadata = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify({ providerStatus: status }), now, attempt.id);
      db.prepare(`UPDATE payments SET reconciliation_status = 'EXCEPTION', updated_at = ? WHERE id = ?`).run(now, payment.id);
    })();
    return db.prepare('SELECT * FROM payment_attempts WHERE id = ?').get(attempt.id);
  }
  db.transaction(() => {
    db.prepare(`UPDATE payment_attempts SET status = 'FAILED', provider_metadata = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify({ providerStatus: status }), now, attempt.id);
    db.prepare(`UPDATE payments SET reconciliation_status = 'EXCEPTION', updated_at = ? WHERE id = ?`).run(now, payment.id);
  })();
  return db.prepare('SELECT * FROM payment_attempts WHERE id = ?').get(attempt.id);
}

function recordMismatch(attempt: any, payment: any, code: string, reason: string, adminId?: string): any {
  const db = getDb();
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`UPDATE payment_attempts SET status = 'MISMATCH', provider_metadata = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify({ mismatchCode: code, reason, at: now }), now, attempt.id);
    db.prepare(`UPDATE payments SET reconciliation_status = 'EXCEPTION', updated_at = ? WHERE id = ?`).run(now, payment.id);
  })();
  try {
    AuditService.log({ adminId, action: 'MONNIFY_ATTEMPT_MISMATCH', entityType: 'PAYMENT', entityId: payment.id, newValues: { code, reason }, notes: reason });
  } catch { /* ignore */ }
  return db.prepare('SELECT * FROM payment_attempts WHERE id = ?').get(attempt.id);
}

export async function handleMonnifyWebhook(params: { rawBody: Buffer; signatureHeader?: string; remoteIp?: string }): Promise<{ duplicate: boolean; attemptId?: string; status: string }> {
  const cfg = requireEnabled();
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production' || cfg.mode === 'live';
  const rawText = params.rawBody.toString('utf8');
  const eventHash = crypto.createHash('sha256').update(params.rawBody).digest('hex');
  const db = getDb();
  const existing = db.prepare('SELECT * FROM monnify_webhook_events WHERE event_hash = ?').get(eventHash) as any;
  if (existing && existing.processing_status === 'PROCESSED') {
    return { duplicate: true, status: existing.processing_result || 'PROCESSED' };
  }
  let parsed: any = null;
  try { parsed = JSON.parse(rawText); } catch { parsed = null; }
  const paymentReference = pickRef(parsed, 'paymentReference', 'payment_reference');
  const transactionReference = pickRef(parsed, 'transactionReference', 'transaction_reference');
  const sigPresent = !!params.signatureHeader;
  let sigValid: boolean | null = null;
  if (isProd) {
    if (!params.signatureHeader) {
      persistEvent({ eventHash, rawText, paymentReference, transactionReference, sigPresent: false, sigValid: false, status: 'FAILED', result: 'Missing monnify-signature in production.' });
      const err: any = new Error('Missing monnify-signature.');
      err.statusCode = 401;
      throw err;
    }
    sigValid = MonnifyClient.verifyWebhookSignature(params.rawBody, params.signatureHeader, cfg.secretKey);
    if (!sigValid) {
      persistEvent({ eventHash, rawText, paymentReference, transactionReference, sigPresent: true, sigValid: false, status: 'FAILED', result: 'Invalid webhook signature.' });
      const err: any = new Error('Invalid webhook signature.');
      err.statusCode = 401;
      throw err;
    }
  }
  if (!paymentReference && !transactionReference) {
    persistEvent({ eventHash, rawText: rawText.slice(0, 4000), paymentReference, transactionReference, sigPresent: sigPresent, sigValid, status: 'FAILED', result: 'Unrecognized webhook payload: no payment or transaction reference.' });
    const err: any = new Error('Webhook payload has no payment or transaction reference.');
    err.statusCode = 400;
    throw err;
  }
  if (existing && existing.processing_status === 'FAILED') {
    // Fall through to reprocessing below (durable recovery); keep same row.
  } else if (!existing) {
    persistEvent({ eventHash, rawText: rawText.slice(0, 20000), paymentReference, transactionReference, sigPresent, sigValid, status: 'RECEIVED', result: null });
  }
  try {
    const attempt = await queryAndReconcile({ merchantReference: paymentReference, transactionReference });
    markEvent(eventHash, 'PROCESSED', `Reconciled attempt ${attempt.id} status=${attempt.status}`);
    return { duplicate: !!existing, attemptId: attempt.id, status: attempt.status };
  } catch (err: any) {
    const retryable = /temporarily unavailable|timed out|network/i.test(err?.message || '');
    markEvent(eventHash, 'FAILED', err?.message || 'Webhook processing failed.');
    if (retryable) {
      const e: any = new Error(err.message);
      e.statusCode = 502;
      throw e;
    }
    throw err;
  }
}

function persistEvent(row: { eventHash: string; rawText: string; paymentReference?: string; transactionReference?: string; sigPresent: boolean; sigValid: boolean | null; status: string; result: string | null }) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO monnify_webhook_events (id, event_hash, payment_reference, transaction_reference, raw_payload, signature_present, signature_valid, processing_status, processing_result, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(`mwh-${crypto.randomUUID()}`, row.eventHash, row.paymentReference || null, row.transactionReference || null,
      row.rawText, row.sigPresent ? 1 : 0, row.sigValid == null ? null : (row.sigValid ? 1 : 0), row.status, row.result, now);
}

function markEvent(eventHash: string, status: string, result: string | null) {
  const db = getDb();
  db.prepare(`UPDATE monnify_webhook_events SET processing_status = ?, processing_result = ?, processed_at = ? WHERE event_hash = ?`)
    .run(status, result, new Date().toISOString(), eventHash);
}
