import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSeed } from '../src/db/seed.js';
import { getDb } from '../src/db/connection.js';
import { config } from '../src/config.js';
import { StudentPhotoService } from '../src/services/studentPhotoService.js';
import { ConversationHandler } from '../src/services/whatsapp/conversationHandler.js';
import { SimulatorProvider } from '../src/services/whatsapp/simulatorProvider.js';
import { PHOTO_UPLOAD_DISCLOSURE_VERSION } from '../src/services/photoDisplayConsentService.js';

const studentId = 'stu-demo-01';
const phone = '+15551001001';

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
  const headers = (extra: Record<string, string> = {}) => ({ get: (k: string) => extra[k.toLowerCase()] ?? null });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (typeof url === 'string' && url.includes('graph.facebook.com')) {
      return { ok: true, json: async () => ({ url: 'https://example.com/media-bytes', mime_type: 'image/png', file_size: bytes.length }) } as any;
    }
    return { ok: true, headers: headers({ 'content-type': 'image/png', length: String(bytes.length) }), arrayBuffer: async () => bytes } as any;
  }));
}

function disclosures() {
  return getDb().prepare('SELECT * FROM whatsapp_photo_disclosures WHERE phone_number = ?').get(phone) as any;
}

const originalToken = config.meta.accessToken;

describe('WhatsApp pre-upload photo disclosure', () => {
  beforeEach(async () => {
    await runSeed(true);
    SimulatorProvider.clearHistory();
    config.meta.accessToken = 'test-media-token';
    vi.unstubAllGlobals();
    config.meta.accessToken = 'test-media-token';
  });

  afterEach(() => {
    config.meta.accessToken = originalToken;
  });

  it('rejects direct WhatsApp submissions that skipped the disclosure', () => {
    expect(() => StudentPhotoService.submitWhatsAppPhoto(studentId, jpeg, { messageId: 'm-x', phoneNumber: phone }))
      .toThrow(/disclosure must be shown/i);
    expect((getDb().prepare('SELECT count(*) c FROM student_photo_submissions').get() as any).c).toBe(0);
    expect((getDb().prepare('SELECT count(*) c FROM photo_display_consents').get() as any).c).toBe(0);
  });

  it('sends the disclosure before accepting, then accepts the resend', async () => {
    mockMediaDownload(validPng());
    await ConversationHandler.processIncomingMessage({ messageId: 'wamid-d1', from: phone, image: { id: 'media-d1' } });
    expect((getDb().prepare('SELECT count(*) c FROM student_photo_submissions').get() as any).c).toBe(0);
    const history = SimulatorProvider.getHistory(phone);
    expect(history.some((m) => (m.text || '').includes('Before you send a photograph'))).toBe(true);
    expect(history.some((m) => (m.text || '').includes('Only authorized hostel personnel'))).toBe(true);
    const shown = disclosures();
    expect(shown?.disclosure_version).toBe(PHOTO_UPLOAD_DISCLOSURE_VERSION);

    await ConversationHandler.processIncomingMessage({ messageId: 'wamid-d2', from: phone, image: { id: 'media-d1' } });
    expect((getDb().prepare('SELECT count(*) c FROM student_photo_submissions').get() as any).c).toBe(1);
    expect((getDb().prepare("SELECT decision FROM photo_display_consents WHERE student_id = ? ORDER BY created_at DESC LIMIT 1").get(studentId) as any)?.decision).toBe('GRANTED');
  });

  it('rejection re-arms the disclosure for the replacement round', async () => {
    ConversationHandler.recordPhotoDisclosure(phone, studentId);
    StudentPhotoService.submitWhatsAppPhoto(studentId, jpeg, { messageId: 'm-r1', phoneNumber: phone }, { disclosureVersion: PHOTO_UPLOAD_DISCLOSURE_VERSION });
    StudentPhotoService.reviewPhoto(studentId, 'REJECTED', 'admin-root-01', 'Too dark');
    expect(disclosures()).toBeUndefined();

    mockMediaDownload(validPng());
    await ConversationHandler.processIncomingMessage({ messageId: 'wamid-d3', from: phone, image: { id: 'media-d3' } });
    // The replacement round starts with a fresh disclosure, not a silent save.
    expect((getDb().prepare("SELECT count(*) c FROM student_photo_submissions WHERE status = 'PENDING_REVIEW'").get() as any).c).toBe(0);
    expect((getDb().prepare("SELECT count(*) c FROM student_photo_submissions WHERE status = 'REJECTED'").get() as any).c).toBe(1);
    const history = SimulatorProvider.getHistory(phone);
    expect(history.some((m) => (m.text || '').includes('Before you send a photograph'))).toBe(true);
  });

  it('disclosure records survive conversation resets', async () => {
    mockMediaDownload(validPng());
    await ConversationHandler.processIncomingMessage({ messageId: 'wamid-d4', from: phone, image: { id: 'media-d4' } });
    ConversationHandler.resetConversation(phone);
    await ConversationHandler.processIncomingMessage({ messageId: 'wamid-d5', from: phone, image: { id: 'media-d4' } });
    expect((getDb().prepare('SELECT count(*) c FROM student_photo_submissions').get() as any).c).toBe(1);
  });
});
