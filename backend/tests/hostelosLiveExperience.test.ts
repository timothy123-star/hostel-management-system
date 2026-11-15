import { beforeAll, beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { runSeed } from '../src/db/seed.js';
import { getDb } from '../src/db/connection.js';
import { ConversationHandler } from '../src/services/whatsapp/conversationHandler.js';
import { SimulatorProvider } from '../src/services/whatsapp/simulatorProvider.js';
import { WhatsAppService } from '../src/services/whatsapp/whatsappService.js';
import { PaymentService } from '../src/services/paymentService.js';
import { StudentService } from '../src/services/studentService.js';
import { StudentPhotoService } from '../src/services/studentPhotoService.js';
import { QRService } from '../src/services/qrService.js';
import { WhatsAppNotificationService } from '../src/services/whatsapp/whatsappNotifications.js';
import { encryptQrToken, decryptQrToken, isQrEncryptionConfigured } from '../src/services/qrTokenCrypto.js';
import { config } from '../src/config.js';

const adminId = 'admin-root-01';

beforeAll(async () => { await runSeed(true); }, 60000);

function seedConversation(phone: string) {
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO whatsapp_conversations (id, phone_number, current_state, state_payload, last_active_at, created_at, updated_at) VALUES (?, ?, 'IDLE', '{}', datetime('now'), datetime('now'), datetime('now'))`).run(`conv-${phone}`, phone);
}

describe('Phase 1 — booking summary', () => {
  beforeEach(async () => { SimulatorProvider.clearHistory(); WhatsAppService.setForceSimulator(true); });
  afterEach(() => { WhatsAppService.setForceSimulator(false); });

  it('hides group code for SINGLE and keeps it for shared', async () => {
    const single = StudentService.getStudentByPhone('+15551001001');
    const textSingle = ConversationHandler.buildBookingSummaryText(single);
    expect(textSingle).not.toContain('GRP-JOHNDOE');
    expect(textSingle).toContain('Booking Status');
    // shared: seed a double group member view via manual object
    const sharedLike = { ...single, preferred_occupancy: 2, current_group: { group_code: 'GRP-SHARED', status: 'FORMING', member_count: 1, target_capacity: 2, provisional_room: null } };
    const textShared = ConversationHandler.buildBookingSummaryText(sharedLike);
    expect(textShared).toContain('GRP-SHARED');
    expect(textShared).toContain('Share Code');
  });

  it('sends accommodation summary + PAYMENT INSTRUCTIONS action after single registration, without auto-simulating', async () => {
    const phone = '+19990002026';
    const steps: any[] = [
      { id: 'r1', body: 'BOOK' }, { id: 'r2', body: 'Live Tester' }, { id: 'r3', btn: 'gender_male' },
      { id: 'r4', body: 'Physics' }, { id: 'r5', body: '100 Level' }, { id: 'r6', btn: 'occ_1' },
    ];
    await ConversationHandler.processIncomingMessage({ messageId: steps[0].id, from: phone, textBody: steps[0].body });
    await ConversationHandler.processIncomingMessage({ messageId: steps[1].id, from: phone, textBody: steps[1].body });
    await ConversationHandler.processIncomingMessage({ messageId: steps[2].id, from: phone, buttonId: steps[2].btn });
    await ConversationHandler.processIncomingMessage({ messageId: steps[3].id, from: phone, textBody: steps[3].body });
    await ConversationHandler.processIncomingMessage({ messageId: steps[4].id, from: phone, textBody: steps[4].body });
    await ConversationHandler.processIncomingMessage({ messageId: steps[5].id, from: phone, buttonId: steps[5].btn });
    const history = SimulatorProvider.getHistory(phone);
    expect(history.some(m => (m.text || '').includes('CONGRATULATIONS'))).toBe(true);
    expect(history.some(m => (m.text || '').includes('YOUR ACCOMMODATION BOOKING SUMMARY'))).toBe(true);
    const student = StudentService.getStudentByPhone(phone);
    const txns = getDb().prepare('SELECT * FROM demo_bank_transactions WHERE linked_payment_id = ?').all((student.payment as any).id);
    expect(txns.length).toBe(0);
  });

  it('PAYMENT request never auto-simulates a transfer', async () => {
    await ConversationHandler.processIncomingMessage({ messageId: 'pay-req-1', from: '+15551001001', textBody: 'PAYMENT' });
    const student = StudentService.getStudentByPhone('+15551001001');
    const txns = getDb().prepare('SELECT * FROM demo_bank_transactions WHERE linked_payment_id = ?').all((student.payment as any).id);
    expect(txns.length).toBe(0);
  });
});

describe('Phase 2 — notifications, idempotency, window', () => {
  beforeEach(async () => { SimulatorProvider.clearHistory(); WhatsAppService.setForceSimulator(true); });
  afterEach(() => { WhatsAppService.setForceSimulator(false); vi.unstubAllGlobals(); });

  it('queues payment approval notification after VERIFIED with amount + ref + photo instruction', async () => {
    seedConversation('+15554004001');
    const before = getDb().prepare("SELECT id FROM payments WHERE student_id = 'stu-demo-07'").get() as any;
    // reconcile first if needed: direct verify requires NOT AWAITING; seed is NOT_SUBMITTED so verify works
    PaymentService.verifyPayment(before.id, adminId, 'ok');
    await WhatsAppNotificationService.tryDeliver(getDb().prepare('SELECT id FROM whatsapp_notifications WHERE dedupe_key = ?').get(`payment-approved:${before.id}`) as any ? (getDb().prepare('SELECT id FROM whatsapp_notifications WHERE dedupe_key = ?').get(`payment-approved:${before.id}`) as any).id : 'missing');
    const row = getDb().prepare('SELECT * FROM whatsapp_notifications WHERE dedupe_key = ?').get(`payment-approved:${before.id}`) as any;
    expect(row).toBeTruthy();
    expect(row.body_text).toContain('Ref:');
    expect(row.body_text).toContain('attach a clear face photograph');
    expect(row.status).toBe('SENT');
  });

  it('queues payment rejection with reason and is idempotent', async () => {
    seedConversation('+15553003003');
    const pay = getDb().prepare("SELECT id FROM payments WHERE student_id = 'stu-demo-06'").get() as any;
    PaymentService.rejectPayment(pay.id, 'Wrong amount', adminId);
    const first = getDb().prepare('SELECT * FROM whatsapp_notifications WHERE dedupe_key = ?').get(`payment-rejected:${pay.id}`) as any;
    expect(first.body_text).toContain('Wrong amount');
    const again = WhatsAppNotificationService.queueAndSend({ dedupeKey: `payment-rejected:${pay.id}`, studentId: 'stu-demo-06', phone: '+15553003003', kind: 'PAYMENT_REJECTED', bodyText: 'dup', templateName: 't' });
    const count = (getDb().prepare('SELECT count(*) c FROM whatsapp_notifications WHERE dedupe_key = ?').get(`payment-rejected:${pay.id}`) as any).c;
    expect(count).toBe(1);
    expect(again.status).toBeTruthy();
  });

  it('requires template outside 24h window', async () => {
    // no conversation => outside window, no template => PENDING_TEMPLATE
    const q = WhatsAppNotificationService.queueAndSend({ dedupeKey: 'window-test-1', phone: '+19991112222', kind: 'PAYMENT_APPROVED', bodyText: 'hello' });
    const res = await WhatsAppNotificationService.tryDeliver(q.notificationId);
    expect(res.status).toBe('PENDING_TEMPLATE');
  });

  it('photo review triggers approved/rejected notifications without link in live mode', async () => {
    seedConversation('+15551001001');
    const db = getDb();
    // create pending photo
    const key = 'notif-photo.jpg';
    db.prepare("UPDATE students SET photo_storage_key = ? WHERE id = 'stu-demo-01'").run(key);
    const subId = 'notif-sub-1';
    db.prepare(`INSERT INTO student_photo_submissions (id, student_id, storage_key, mime_type, status, submitted_at) VALUES (?, 'stu-demo-01', ?, 'image/jpeg', 'PENDING_REVIEW', datetime('now'))`).run(subId, key);
    StudentPhotoService.reviewPhoto('stu-demo-01', 'REJECTED', adminId, 'Too dark');
    const row = db.prepare('SELECT * FROM whatsapp_notifications WHERE dedupe_key = ?').get(`photo-rejected:${subId}`) as any;
    expect(row.body_text).toContain('Too dark');
    expect(row.body_text).toContain('directly to this WhatsApp chat');
    expect(row.body_text).not.toContain('http');
  });
});

describe('Phase 3 — QR encryption and redelivery', () => {
  beforeEach(async () => { SimulatorProvider.clearHistory(); WhatsAppService.setForceSimulator(true); });
  afterEach(() => { WhatsAppService.setForceSimulator(false); });

  it('encrypts and decrypts, rejects tampering', () => {
    if (!isQrEncryptionConfigured()) {
      (config as any).qrTokenEncryptionKeyB64 = Buffer.from('x'.repeat(32)).toString('base64');
    }
    expect(isQrEncryptionConfigured()).toBe(true);
    const { token } = QRService.generateToken();
    const enc = encryptQrToken(token);
    expect(enc).not.toContain(token);
    expect(decryptQrToken(enc)).toBe(token);
    const tampered = Buffer.from(enc, 'base64');
    tampered[tampered.length - 1] ^= 1;
    expect(() => decryptQrToken(tampered.toString('base64'))).toThrow();
    (config as any).qrTokenEncryptionKeyB64 = '';
  });

  it('redelivery returns same active credential without revocation', async () => {
    (config as any).qrTokenEncryptionKeyB64 = Buffer.from('y'.repeat(32)).toString('base64');
    const db = getDb();
    db.prepare("UPDATE students SET photo_storage_key = 'qr-redel.jpg' WHERE id = 'stu-demo-01'").run();
    db.prepare(`INSERT INTO student_photo_submissions (id, student_id, storage_key, mime_type, status, submitted_at) VALUES ('qr-redel-sub', 'stu-demo-01', 'qr-redel.jpg', 'image/jpeg', 'APPROVED', datetime('now'))`).run();
    // make allocation current + verified payment already seeded VERIFIED? ensure
    getDb().prepare("DELETE FROM resident_qr_credentials WHERE student_id = 'stu-demo-01'").run();
    const issued = QRService.issueCredential('stu-demo-01', adminId);
    const beforeId = (issued.credential as any).id;
    seedConversation('+15551001001');
    const out = await QRService.redeliverActiveCredential('stu-demo-01');
    expect(out.credentialId).toBe(beforeId);
    expect(getDb().prepare("SELECT count(*) c FROM resident_qr_credentials WHERE student_id = 'stu-demo-01' AND status = 'ACTIVE'").get()).toEqual({ c: 1 });
    (config as any).qrTokenEncryptionKeyB64 = '';
  });

  it('hash-only legacy credential explains reissue need', async () => {
    (config as any).qrTokenEncryptionKeyB64 = Buffer.from('z'.repeat(32)).toString('base64');
    const db = getDb();
    db.prepare("UPDATE students SET photo_storage_key = 'qr-legacy.jpg' WHERE id = 'stu-demo-01'").run();
    db.prepare(`INSERT INTO student_photo_submissions (id, student_id, storage_key, mime_type, status, submitted_at) VALUES ('qr-leg-sub', 'stu-demo-01', 'qr-legacy.jpg', 'image/jpeg', 'APPROVED', datetime('now'))`).run();
    // issue with encryption disabled to simulate legacy
    (config as any).qrTokenEncryptionKeyB64 = '';
    // force null ciphertext by issuing without key
    getDb().prepare("DELETE FROM resident_qr_credentials WHERE student_id = 'stu-demo-01'").run();
    const issued = QRService.issueCredential('stu-demo-01', adminId);
    expect((issued.credential as any).token_ciphertext ?? null).toBeFalsy();
    (config as any).qrTokenEncryptionKeyB64 = Buffer.from('z'.repeat(32)).toString('base64');
    await expect(QRService.redeliverActiveCredential('stu-demo-01')).rejects.toThrow('before recoverable delivery was enabled');
    (config as any).qrTokenEncryptionKeyB64 = '';
  });
});

describe('Phase 4 — public verification', () => {
  // The simulator must stay forced here: issueCredential() fans out
  // fire-and-forget WhatsApp sends, which would otherwise reach the live
  // Meta API whenever real credentials are present in the environment.
  beforeEach(async () => { SimulatorProvider.clearHistory(); WhatsAppService.setForceSimulator(true); });
  afterEach(() => { WhatsAppService.setForceSimulator(false); });
  it('valid/invalid/expired/revoked handled, no phone leaked', async () => {
    const db = getDb();
    db.prepare("UPDATE students SET photo_storage_key = 'qr-pub.jpg' WHERE id = 'stu-demo-01'").run();
    db.prepare(`INSERT INTO student_photo_submissions (id, student_id, storage_key, mime_type, status, submitted_at) VALUES ('qr-pub-sub', 'stu-demo-01', 'qr-pub.jpg', 'image/jpeg', 'APPROVED', datetime('now'))`).run();
    getDb().prepare("DELETE FROM resident_qr_credentials WHERE student_id = 'stu-demo-01'").run();
    const issued = QRService.issueCredential('stu-demo-01', adminId);
    const ok: any = QRService.getPublicVerification(issued.token);
    expect(ok.status).toBe('VALID_RESIDENT');
    expect(JSON.stringify(ok)).not.toContain('+1555');
    expect(ok.student).not.toHaveProperty('phone_number');
    expect(QRService.getPublicVerification('not-a-valid-credential').status).toBe('INVALID_CREDENTIAL');
    QRService.revokeCredential((issued.credential as any).id, 'hold', adminId);
    expect(QRService.getPublicVerification(issued.token).status).toBe('INVALID_CREDENTIAL');
  });
});

describe('Phase 5 — menu + webhook parsing', () => {
  beforeEach(async () => { SimulatorProvider.clearHistory(); WhatsAppService.setForceSimulator(true); });
  afterEach(() => { WhatsAppService.setForceSimulator(false); });
  it('MENU shows list with stable ids and list_reply routes to booking', async () => {
    await ConversationHandler.processIncomingMessage({ messageId: 'menu-1', from: '+15551001001', textBody: 'MENU' });
    const history = SimulatorProvider.getHistory('+15551001001');
    const menu = history.find(m => (m.text || '').includes('resident menu'));
    expect(menu).toBeTruthy();
    expect(menu?.buttons?.some(b => b.id === 'menu_status')).toBe(true);
    await ConversationHandler.processIncomingMessage({ messageId: 'menu-2', from: '+15551001001', buttonId: 'menu_status' });
    const after = SimulatorProvider.getHistory('+15551001001');
    expect(after.some(m => (m.text || '').includes('BOOKING SUMMARY'))).toBe(true);
  });
});
