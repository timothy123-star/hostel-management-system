import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import { runSeed } from '../src/db/seed.js';
import { getDb } from '../src/db/connection.js';
import { config } from '../src/config.js';
import { StudentPhotoService } from '../src/services/studentPhotoService.js';
import { ConversationHandler } from '../src/services/whatsapp/conversationHandler.js';
import { SimulatorProvider } from '../src/services/whatsapp/simulatorProvider.js';
import { QRService } from '../src/services/qrService.js';
import { WhatsAppService } from '../src/services/whatsapp/whatsappService.js';
import { PHOTO_UPLOAD_DISCLOSURE_VERSION } from '../src/services/photoDisplayConsentService.js';

const studentA = 'stu-demo-01';
const phoneA = '+15551001001';
const studentB = 'stu-reuse-01';
const adminId = 'admin-root-01';

const jpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0x01,
  0x11, 0x00, 0xff, 0xd9,
]);

function validPng(): Buffer {
  const buf = Buffer.alloc(48, 0);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12);
  buf.writeUInt32BE(1, 16);
  buf.writeUInt32BE(1, 20);
  Buffer.from('IEND').copy(buf, 40);
  return buf;
}

function mockMediaDownload(bytes: Buffer) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (typeof url === 'string' && url.includes('graph.facebook.com')) {
      return { ok: true, json: async () => ({ url: 'https://example.com/media-bytes', mime_type: 'image/png', file_size: bytes.length }) } as any;
    }
    const headers = { get: () => null };
    return { ok: true, headers, arrayBuffer: async () => bytes } as any;
  }));
}

function submissions(student = studentA) {
  return (getDb().prepare('SELECT count(*) c FROM student_photo_submissions WHERE student_id = ?').get(student) as any).c;
}

function consents(student = studentA) {
  return getDb().prepare('SELECT decision FROM photo_display_consents WHERE student_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(student) as any;
}

function createStudentB() {
  getDb().prepare(`INSERT INTO students (id, full_name, phone_number, gender, department, academic_level, preferred_occupancy, roommate_mode, consent_random_matching, created_at, updated_at)
    VALUES (?, 'Reuse Resident', ?, 'MALE', 'Engineering', '100', 1, 'KNOWN', 0, datetime('now'), datetime('now'))`)
    .run(studentB, phoneA);
}

/** Exact production incident: A disclosed, A's number tombstoned, B reuses the number. */
function givenPhoneReuse() {
  ConversationHandler.recordPhotoDisclosure(phoneA, studentA);
  getDb().prepare('UPDATE students SET phone_number = ? WHERE id = ?').run(`RETIRED-${studentA}`, studentA);
  createStudentB();
}

const originalToken = config.meta.accessToken;

describe('photo consent phone-reuse hardening', () => {
  beforeEach(async () => {
    await runSeed(true);
    WhatsAppService.setForceSimulator(true);
    SimulatorProvider.clearHistory();
    config.meta.accessToken = 'test-media-token';
    vi.unstubAllGlobals();
    config.meta.accessToken = 'test-media-token';
    fs.rmSync(config.photoStorageDir, { recursive: true, force: true });
  });

  afterEach(() => {
    config.meta.accessToken = originalToken;
    vi.restoreAllMocks();
  });

  it('1. old phone disclosure from student A cannot authorize student B', async () => {
    givenPhoneReuse();
    expect(ConversationHandler.hasPhotoDisclosure(phoneA, studentB)).toBe(false);
    mockMediaDownload(validPng());
    await ConversationHandler.processIncomingMessage({ messageId: 'wamid-reuse-1', from: phoneA, image: { id: 'media-r1' } });
    expect(submissions(studentB)).toBe(0);
    expect(consents(studentB)).toBeUndefined();
    const history = SimulatorProvider.getHistory(phoneA);
    expect(history.some((m) => (m.text || '').includes('Before you send a photograph'))).toBe(true);
    expect(history.some((m) => (m.text || '').includes('after the disclosure'))).toBe(false);
  });

  it('2. same phone, same student, current version, earlier disclosure permits submission', async () => {
    ConversationHandler.recordPhotoDisclosure(phoneA, studentA);
    expect(ConversationHandler.hasPhotoDisclosure(phoneA, studentA)).toBe(true);
    mockMediaDownload(validPng());
    await ConversationHandler.processIncomingMessage({ messageId: 'wamid-ok-1', from: phoneA, image: { id: 'media-ok' } });
    expect(submissions()).toBe(1);
    expect(consents()?.decision).toBe('GRANTED');
  });

  it('3/4/5. missing disclosure triggers resend flow; nothing stored, no consent', async () => {
    mockMediaDownload(validPng());
    await ConversationHandler.processIncomingMessage({ messageId: 'wamid-m1', from: phoneA, image: { id: 'media-m1' } });
    expect(submissions()).toBe(0);
    expect(consents()).toBeUndefined();
    expect((getDb().prepare('SELECT photo_storage_key FROM students WHERE id = ?').get(studentA) as any)?.photo_storage_key).toBeNull();
    const history = SimulatorProvider.getHistory(phoneA);
    expect(history.some((m) => (m.text || '').includes('Before you send a photograph'))).toBe(true);
    expect(history.some((m) => (m.text || '').includes('resend'))).toBe(true);
  });

  it('6. caller cannot forge consent by supplying the current disclosureVersion', () => {
    expect(() => StudentPhotoService.submitWhatsAppPhoto(studentA, jpeg, { messageId: 'm-forge', phoneNumber: phoneA }, { disclosureVersion: PHOTO_UPLOAD_DISCLOSURE_VERSION }))
      .toThrow(/disclosure must be shown/i);
    expect(submissions()).toBe(0);
    expect(consents()).toBeUndefined();
  });

  it('7. disclosure belonging to another student fails closed', () => {
    getDb().prepare(`INSERT INTO students (id, full_name, phone_number, gender, department, academic_level, preferred_occupancy, roommate_mode, consent_random_matching, created_at, updated_at)
      VALUES (?, 'Other Resident', '+15551001002', 'MALE', 'Engineering', '100', 1, 'KNOWN', 0, datetime('now'), datetime('now'))`)
      .run(studentB);
    ConversationHandler.recordPhotoDisclosure(phoneA, studentB);
    expect(ConversationHandler.hasPhotoDisclosure(phoneA, studentA)).toBe(false);
    expect(() => StudentPhotoService.submitWhatsAppPhoto(studentA, jpeg, { messageId: 'm-other', phoneNumber: phoneA }, { disclosureVersion: PHOTO_UPLOAD_DISCLOSURE_VERSION }))
      .toThrow(/disclosure must be shown/i);
    expect(submissions()).toBe(0);
  });

  it('8. incorrect disclosure version fails closed', () => {
    const now = new Date().toISOString();
    getDb().prepare('INSERT INTO whatsapp_photo_disclosures (phone_number, student_id, disclosure_version, shown_at, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(phoneA, studentA, 'legacy-version-0', now, now);
    expect(ConversationHandler.hasPhotoDisclosure(phoneA, studentA)).toBe(false);
    expect(() => StudentPhotoService.submitWhatsAppPhoto(studentA, jpeg, { messageId: 'm-ver', phoneNumber: phoneA }, { disclosureVersion: PHOTO_UPLOAD_DISCLOSURE_VERSION }))
      .toThrow(/disclosure must be shown/i);
    expect(submissions()).toBe(0);
  });

  it('9. future-dated disclosure fails closed', () => {
    const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    getDb().prepare('INSERT INTO whatsapp_photo_disclosures (phone_number, student_id, disclosure_version, shown_at, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(phoneA, studentA, PHOTO_UPLOAD_DISCLOSURE_VERSION, future, future);
    expect(ConversationHandler.hasPhotoDisclosure(phoneA, studentA)).toBe(false);
    expect(() => StudentPhotoService.submitWhatsAppPhoto(studentA, jpeg, { messageId: 'm-future', phoneNumber: phoneA }, { disclosureVersion: PHOTO_UPLOAD_DISCLOSURE_VERSION }))
      .toThrow(/disclosure must be shown/i);
    expect(submissions()).toBe(0);
    expect(consents()).toBeUndefined();
  });

  it('10. successful second image creates the correct current-student consent', async () => {
    givenPhoneReuse();
    mockMediaDownload(validPng());
    await ConversationHandler.processIncomingMessage({ messageId: 'wamid-reuse-2', from: phoneA, image: { id: 'media-r2' } });
    await ConversationHandler.processIncomingMessage({ messageId: 'wamid-reuse-3', from: phoneA, image: { id: 'media-r2' } });
    expect(submissions(studentB)).toBe(1);
    const row = getDb().prepare('SELECT student_id, decision FROM photo_display_consents WHERE student_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(studentB) as any;
    expect(row?.decision).toBe('GRANTED');
    expect(row?.student_id).toBe(studentB);
    expect(submissions(studentA)).toBe(0);
  });

  it('11. disclosure send failure never produces a false agreement claim', async () => {
    const send = vi.spyOn(SimulatorProvider.prototype, 'sendTextMessage').mockRejectedValueOnce(new Error('network down'));
    await expect(ConversationHandler.processIncomingMessage({ messageId: 'wamid-fail-1', from: phoneA, image: { id: 'media-f1' } })).rejects.toThrow(/network down/);
    send.mockRestore();
    expect(getDb().prepare('SELECT * FROM whatsapp_photo_disclosures WHERE phone_number = ?').get(phoneA)).toBeUndefined();
    expect(submissions()).toBe(0);
    expect(consents()).toBeUndefined();
    const history = SimulatorProvider.getHistory(phoneA);
    expect(history.some((m) => (m.text || '').includes('after the disclosure'))).toBe(false);
    expect(history.some((m) => (m.text || '').includes('PENDING REVIEW'))).toBe(false);
  });

  it('12/13/14. CONSENT NO withholds photo from MANAGER and SECURITY but QR still verifies', async () => {
    ConversationHandler.recordPhotoDisclosure(phoneA, studentA);
    mockMediaDownload(validPng());
    await ConversationHandler.processIncomingMessage({ messageId: 'wamid-wd-1', from: phoneA, image: { id: 'media-wd' } });
    StudentPhotoService.reviewPhoto(studentA, 'APPROVED', adminId);
    const issued = QRService.issueCredential(studentA, adminId);
    expect((QRService.getPublicVerification(issued.token, 'MANAGER', adminId, 'MANAGER') as any).photo_display).toBe('CONSENTED');
    expect(QRService.getPhotoAvailability(studentA).available).toBe(true);

    await ConversationHandler.processIncomingMessage({ messageId: 'wamid-wd-2', from: phoneA, textBody: 'CONSENT NO' });
    const status = (await import('../src/services/photoDisplayConsentService.js')).PhotoDisplayConsentService.getCurrentStatus(studentA);
    expect(status.decision).toBe('WITHDRAWN');
    expect(QRService.getPhotoAvailability(studentA).available).toBe(false);
    expect((QRService.getPublicVerification(issued.token, 'MANAGER', adminId, 'MANAGER') as any).photo_display).toBe('WITHHELD');
    expect((QRService.getPublicVerification(issued.token, 'MANAGER', adminId, 'SECURITY') as any).photo_display).toBe('WITHHELD');
    expect(() => QRService.getVerifiedPhoto(issued.token, 'MANAGER', adminId, 'SECURITY')).toThrow();
    const verified = QRService.verifyToken(issued.token, 'MANAGER', 'MANUAL_ENTRY', adminId, 'SECURITY') as any;
    expect(verified.outcome).toBe('GRANTED');
    expect(verified.student?.id).toBe(studentA);
  });

  it('15. initial photo approval synchronizes students.photo_status', () => {
    ConversationHandler.recordPhotoDisclosure(phoneA, studentA);
    StudentPhotoService.submitWhatsAppPhoto(studentA, jpeg, { messageId: 'm-st', phoneNumber: phoneA }, { disclosureVersion: PHOTO_UPLOAD_DISCLOSURE_VERSION });
    expect((getDb().prepare('SELECT photo_status FROM students WHERE id = ?').get(studentA) as any).photo_status).toBe('PENDING_REVIEW');
    StudentPhotoService.reviewPhoto(studentA, 'APPROVED', adminId);
    expect((getDb().prepare('SELECT photo_status FROM students WHERE id = ?').get(studentA) as any).photo_status).toBe('APPROVED');
  });

  it('16. replacement approval preserves the old active photo until approval', () => {
    ConversationHandler.recordPhotoDisclosure(phoneA, studentA);
    StudentPhotoService.submitWhatsAppPhoto(studentA, jpeg, { messageId: 'm-rp1', phoneNumber: phoneA }, { disclosureVersion: PHOTO_UPLOAD_DISCLOSURE_VERSION });
    StudentPhotoService.reviewPhoto(studentA, 'APPROVED', adminId);
    const active = (getDb().prepare('SELECT photo_storage_key FROM students WHERE id = ?').get(studentA) as any).photo_storage_key;
    const res = StudentPhotoService.submitWhatsAppPhoto(studentA, jpeg, { messageId: 'm-rp2', phoneNumber: phoneA }, { disclosureVersion: PHOTO_UPLOAD_DISCLOSURE_VERSION });
    expect(res.isReplacement).toBe(true);
    expect((getDb().prepare('SELECT photo_storage_key FROM students WHERE id = ?').get(studentA) as any).photo_storage_key).toBe(active);
    StudentPhotoService.reviewPhoto(studentA, 'APPROVED', adminId);
    const after = (getDb().prepare('SELECT photo_storage_key FROM students WHERE id = ?').get(studentA) as any).photo_storage_key;
    expect(after).not.toBe(active);
    expect((getDb().prepare('SELECT count(*) c FROM student_photo_submissions WHERE status = ?').get('APPROVED') as any).c).toBe(2);
  });

  it('17. replacement rejection preserves the previous approved photo', () => {
    ConversationHandler.recordPhotoDisclosure(phoneA, studentA);
    StudentPhotoService.submitWhatsAppPhoto(studentA, jpeg, { messageId: 'm-rj1', phoneNumber: phoneA }, { disclosureVersion: PHOTO_UPLOAD_DISCLOSURE_VERSION });
    StudentPhotoService.reviewPhoto(studentA, 'APPROVED', adminId);
    const active = (getDb().prepare('SELECT photo_storage_key FROM students WHERE id = ?').get(studentA) as any).photo_storage_key;
    StudentPhotoService.submitWhatsAppPhoto(studentA, jpeg, { messageId: 'm-rj2', phoneNumber: phoneA }, { disclosureVersion: PHOTO_UPLOAD_DISCLOSURE_VERSION });
    StudentPhotoService.reviewPhoto(studentA, 'REJECTED', adminId, 'Too dark');
    expect((getDb().prepare('SELECT photo_storage_key FROM students WHERE id = ?').get(studentA) as any).photo_storage_key).toBe(active);
    expect((getDb().prepare(`SELECT ps.status FROM students s JOIN student_photo_submissions ps ON ps.storage_key = s.photo_storage_key WHERE s.id = ?`).get(studentA) as any).status).toBe('APPROVED');
    expect(QRService.getPhotoAvailability(studentA).available).toBe(true);
  });

  it('18. photo audit history remains intact across submit, approve, withdraw', async () => {
    ConversationHandler.recordPhotoDisclosure(phoneA, studentA);
    mockMediaDownload(validPng());
    await ConversationHandler.processIncomingMessage({ messageId: 'wamid-au-1', from: phoneA, image: { id: 'media-au' } });
    StudentPhotoService.reviewPhoto(studentA, 'APPROVED', adminId);
    await ConversationHandler.processIncomingMessage({ messageId: 'wamid-au-2', from: phoneA, textBody: 'CONSENT PHOTO NO' });
    const actions = getDb().prepare("SELECT action FROM audit_logs WHERE entity_id = ? AND action LIKE '%PHOTO%' ORDER BY created_at, rowid").all(studentA) as any[];
    expect(actions.map((a) => a.action)).toEqual(expect.arrayContaining(['SUBMIT_STUDENT_PHOTO', 'GRANT_PHOTO_DISPLAY_CONSENT', 'APPROVE_STUDENT_PHOTO', 'WITHDRAW_PHOTO_DISPLAY_CONSENT']));
    expect(actions.length).toBeGreaterThanOrEqual(4);
  });
});
