import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSeed } from '../src/db/seed.js';
import { getDb } from '../src/db/connection.js';
import { config } from '../src/config.js';
import { WhatsAppService } from '../src/services/whatsapp/whatsappService.js';
import { SimulatorProvider } from '../src/services/whatsapp/simulatorProvider.js';
import { WhatsAppNotificationService } from '../src/services/whatsapp/whatsappNotifications.js';
import { PaymentService } from '../src/services/paymentService.js';
import { StudentPhotoService } from '../src/services/studentPhotoService.js';
import { QRService } from '../src/services/qrService.js';

const adminId = 'admin-root-01';

async function waitFor<T>(fn: () => T | null | undefined, timeoutMs = 8000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v as T;
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}

function outsideWindow(phone: string) {
  getDb().prepare('DELETE FROM whatsapp_conversations WHERE phone_number = ?').run(phone);
}

function rowByDedupe(dedupeKey: string) {
  return getDb().prepare('SELECT * FROM whatsapp_notifications WHERE dedupe_key = ?').get(dedupeKey) as any;
}

async function sentRow(dedupeKey: string) {
  return waitFor(() => {
    const row = rowByDedupe(dedupeKey);
    return row && row.status === 'SENT' ? row : null;
  });
}

function makePendingPhoto(studentId: string, key: string) {
  const db = getDb();
  db.prepare('UPDATE students SET photo_storage_key = ? WHERE id = ?').run(key, studentId);
  db.prepare(`INSERT INTO student_photo_submissions (id, student_id, storage_key, mime_type, status, submitted_at)
    VALUES (?, ?, ?, 'image/jpeg', 'PENDING_REVIEW', datetime('now'))`).run(`ps-${key}`, studentId, key);
}

function approveCurrentPhoto(studentId: string, key: string) {
  const db = getDb();
  db.prepare('UPDATE students SET photo_storage_key = ? WHERE id = ?').run(key, studentId);
  db.prepare(`INSERT INTO student_photo_submissions (id, student_id, storage_key, mime_type, status, submitted_at, reviewed_by_admin_id, reviewed_at)
    VALUES (?, ?, ?, 'image/jpeg', 'APPROVED', datetime('now'), ?, datetime('now'))`).run(`ps-${key}`, studentId, key, adminId);
}

describe('WhatsApp template parameters', () => {
  let tplSpy: any;
  let textSpy: any;

  beforeEach(async () => {
    await runSeed(true);
    SimulatorProvider.clearHistory();
    const provider = WhatsAppService.getProvider() as any;
    tplSpy = vi.spyOn(provider, 'sendTemplateMessage');
    textSpy = vi.spyOn(provider, 'sendTextMessage');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('payment approved sends ordered [amount, currency, reference]', async () => {
    outsideWindow('+15553003003');
    PaymentService.verifyPayment('pay-demo-06', adminId, 'ok');
    const row = await sentRow('payment-approved:pay-demo-06');
    expect(row.template_name).toBe('hostelos_payment_approved');
    expect(JSON.parse(row.template_params)).toEqual(['600', 'USD', 'PAY-REF-LG-06']);
    const call = await waitFor(() => tplSpy.mock.calls.find((c: any[]) => c[1] === 'hostelos_payment_approved'));
    expect(call[0]).toBe('+15553003003');
    expect(call[2]).toBe('en');
    expect(call[3]).toEqual(['600', 'USD', 'PAY-REF-LG-06']);
    expect(row.body_text).toContain('PAY-REF-LG-06');
  });

  it('payment rejected sends ordered [reference, reason]', async () => {
    outsideWindow('+15554004001');
    PaymentService.rejectPayment('pay-demo-07', 'Wrong amount', adminId);
    const row = await sentRow('payment-rejected:pay-demo-07');
    expect(row.template_name).toBe('hostelos_payment_rejected');
    expect(JSON.parse(row.template_params)).toEqual(['PAY-REF-CB-07', 'Wrong amount']);
    const call = await waitFor(() => tplSpy.mock.calls.find((c: any[]) => c[1] === 'hostelos_payment_rejected'));
    expect(call[3]).toEqual(['PAY-REF-CB-07', 'Wrong amount']);
  });

  it('photo approved sends zero parameters', async () => {
    outsideWindow('+15553003001');
    makePendingPhoto('stu-demo-04', 'tpl-photo-ok.jpg');
    StudentPhotoService.reviewPhoto('stu-demo-04', 'APPROVED', adminId);
    const row = await sentRow('photo-approved:ps-tpl-photo-ok.jpg');
    expect(row.template_name).toBe('hostelos_photo_approved');
    expect(JSON.parse(row.template_params)).toEqual([]);
    const call = await waitFor(() => tplSpy.mock.calls.find((c: any[]) => c[1] === 'hostelos_photo_approved'));
    expect(call[2]).toBe('en');
    expect(call[3]).toEqual([]);
  });

  it('photo rejected sends ordered [reason]', async () => {
    outsideWindow('+15553003002');
    makePendingPhoto('stu-demo-05', 'tpl-photo-bad.jpg');
    StudentPhotoService.reviewPhoto('stu-demo-05', 'REJECTED', adminId, 'Too dark');
    const row = await sentRow('photo-rejected:ps-tpl-photo-bad.jpg');
    expect(row.template_name).toBe('hostelos_photo_rejected');
    expect(JSON.parse(row.template_params)).toEqual(['Too dark']);
    const call = await waitFor(() => tplSpy.mock.calls.find((c: any[]) => c[1] === 'hostelos_photo_rejected'));
    expect(call[3]).toEqual(['Too dark']);
  });

  it('QR issued sends zero parameters', async () => {
    outsideWindow('+15551001001');
    approveCurrentPhoto('stu-demo-01', 'tpl-qr.jpg');
    QRService.issueCredential('stu-demo-01', adminId);
    const row = await waitFor(() => {
      const r = getDb().prepare("SELECT * FROM whatsapp_notifications WHERE dedupe_key LIKE 'qr-issued:resident-qr-%' AND body_text LIKE '%identity pass has been issued%' ORDER BY created_at DESC LIMIT 1").get() as any;
      return r && r.status === 'SENT' ? r : null;
    });
    expect(row.template_name).toBe('hostelos_qr_issued');
    expect(JSON.parse(row.template_params)).toEqual([]);
  });

  it('QR image failure uses its own template with the error parameter', async () => {
    expect(config.whatsappTemplates.qrImageFailed).toBe('hostelos_qr_image_failed');
    outsideWindow('+15551001001');
    approveCurrentPhoto('stu-demo-01', 'tpl-qr-fail.jpg');
    const provider = WhatsAppService.getProvider() as any;
    vi.spyOn(provider, 'sendImageBuffer').mockRejectedValueOnce(new Error('simulated-media-boom'));
    QRService.issueCredential('stu-demo-01', adminId, true);
    const row = await waitFor(() => {
      const r = getDb().prepare("SELECT * FROM whatsapp_notifications WHERE dedupe_key LIKE 'qr-issued-image-failed:%' ORDER BY created_at DESC LIMIT 1").get() as any;
      return r && r.status === 'SENT' ? r : null;
    });
    expect(row.template_name).toBe('hostelos_qr_image_failed');
    expect(row.template_name).not.toBe('hostelos_qr_issued');
    expect(JSON.parse(row.template_params)).toEqual(['simulated-media-boom']);
    const call = await waitFor(() => tplSpy.mock.calls.find((c: any[]) => c[1] === 'hostelos_qr_image_failed'));
    expect(call[3]).toEqual(['simulated-media-boom']);
  });

  it('legacy rows without template_params fall back to [body_text]', async () => {
    getDb().prepare(`INSERT INTO whatsapp_notifications (id, dedupe_key, student_id, phone_number, kind, body_text, template_name, status, attempts, created_at, updated_at)
      VALUES ('wano-legacy-1', 'legacy-dedupe-1', NULL, '+19991112222', 'PAYMENT_APPROVED', 'legacy body', 'hostelos_payment_approved', 'QUEUED', 0, datetime('now'), datetime('now'))`).run();
    const res = await WhatsAppNotificationService.tryDeliver('wano-legacy-1');
    expect(res.status).toBe('SENT');
    expect(tplSpy).toHaveBeenCalledWith('+19991112222', 'hostelos_payment_approved', 'en', ['legacy body']);
  });

  it('free-form bodyText is used inside the 24-hour window', async () => {
    const phone = '+19998887777';
    const now = new Date().toISOString();
    getDb().prepare(`INSERT INTO whatsapp_conversations (id, phone_number, current_state, state_payload, last_active_at, created_at, updated_at)
      VALUES ('conv-window-1', ?, 'IDLE', '{}', ?, ?, ?)`).run(phone, now, now, now);
    WhatsAppNotificationService.queueAndSend({
      dedupeKey: 'window-dedupe-1',
      phone,
      kind: 'PAYMENT_APPROVED',
      bodyText: 'in-window free text',
      templateName: 'hostelos_payment_approved',
      templateParams: ['a', 'b', 'c'],
    });
    const row = await sentRow('window-dedupe-1');
    expect(row.status).toBe('SENT');
    expect(textSpy).toHaveBeenCalledWith(phone, 'in-window free text');
    expect(tplSpy.mock.calls.find((c: any[]) => c[0] === phone)).toBeUndefined();
  });

  it('stored template_params round-trip in order for all six cases', () => {
    const cases: Array<[string, string[], string]> = [
      ['pay-appr', ['600', 'USD', 'PAY-REF-LG-06'], 'hostelos_payment_approved'],
      ['pay-rej', ['PAY-REF-CB-07', 'Wrong amount'], 'hostelos_payment_rejected'],
      ['photo-ok', [], 'hostelos_photo_approved'],
      ['photo-no', ['Too dark'], 'hostelos_photo_rejected'],
      ['qr-ok', [], 'hostelos_qr_issued'],
      ['qr-img-fail', ['boom'], 'hostelos_qr_image_failed'],
    ];
    for (const [suffix, params, tpl] of cases) {
      const { notificationId } = WhatsAppNotificationService.queueAndSend({
        dedupeKey: `order-${suffix}`,
        phone: '+19990001111',
        kind: 'QR_ISSUED',
        bodyText: `order ${suffix}`,
        templateName: tpl,
        templateParams: params,
      });
      const stored = getDb().prepare('SELECT template_params FROM whatsapp_notifications WHERE id = ?').get(notificationId) as any;
      expect(JSON.parse(stored.template_params)).toEqual(params);
    }
  });

  it('manager authorization and approval rules remain intact', () => {
    expect(() => (PaymentService as any).verifyPayment('pay-demo-07', undefined)).toThrow('authenticated manager');
    expect(() => PaymentService.rejectPayment('pay-demo-07', 'r', undefined)).toThrow('authenticated manager');
    expect(() => StudentPhotoService.reviewPhoto('stu-demo-04', 'REJECTED', adminId)).toThrow('rejection reason');
    expect(() => QRService.issueCredential('stu-demo-01', '' as any)).toThrow();
    expect(getDb().prepare("SELECT status FROM payments WHERE id = 'pay-demo-07'").get()).toEqual({ status: 'PENDING' });
  });
});
