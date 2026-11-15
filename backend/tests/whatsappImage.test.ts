import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { runSeed } from '../src/db/seed.js';
import { ConversationHandler } from '../src/services/whatsapp/conversationHandler.js';
import { SimulatorProvider } from '../src/services/whatsapp/simulatorProvider.js';
import { StudentPhotoService } from '../src/services/studentPhotoService.js';
import { WhatsAppMediaService } from '../src/services/whatsapp/whatsappMediaService.js';
import { getDb } from '../src/db/connection.js';
import { config } from '../src/config.js';

const originalToken = config.meta.accessToken;
const originalFetch = globalThis.fetch;

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

function mockMediaDownload(bytes: Buffer, mime = 'image/png') {
  const headers = (extra: Record<string, string> = {}) => ({ get: (k: string) => extra[k.toLowerCase()] ?? null });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (typeof url === 'string' && url.includes('graph.facebook.com')) {
      return { ok: true, json: async () => ({ url: 'https://example.com/media-bytes', mime_type: mime, file_size: bytes.length }) } as any;
    }
    return { ok: true, headers: headers({ 'content-type': mime, 'content-length': String(bytes.length) }), arrayBuffer: async () => bytes } as any;
  }));
}

describe('WhatsApp inbound image photographs', () => {
  beforeEach(async () => {
    await runSeed(true);
    SimulatorProvider.clearHistory();
    config.meta.accessToken = 'test-media-token';
  });

  function givenDisclosure(phone = '+15551001001', studentId = 'stu-demo-01') {
    ConversationHandler.recordPhotoDisclosure(phone, studentId);
  }

  afterEach(() => {
    config.meta.accessToken = originalToken;
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('shows the disclosure before accepting a photograph, then processes the resend', async () => {
    const png = validPng();
    mockMediaDownload(png);
    await ConversationHandler.processIncomingMessage({ messageId: 'wamid-img-1', from: '+15551001001', image: { id: 'media-1', mime_type: 'image/png' } });

    // First image is never stored and never grants permission: the resident
    // gets the disclosure and must resend.
    expect((getDb().prepare('SELECT count(*) c FROM student_photo_submissions').get() as any).c).toBe(0);
    expect((getDb().prepare('SELECT count(*) c FROM photo_display_consents').get() as any).c).toBe(0);
    const firstHistory = SimulatorProvider.getHistory('+15551001001');
    expect(firstHistory.some(m => (m.text || '').includes('Before you send a photograph'))).toBe(true);
    expect(firstHistory.some(m => (m.text || '').includes('resend'))).toBe(true);

    await ConversationHandler.processIncomingMessage({ messageId: 'wamid-img-1b', from: '+15551001001', image: { id: 'media-1', mime_type: 'image/png' } });
    const row = getDb().prepare(`SELECT s.photo_status, ps.status FROM students s JOIN student_photo_submissions ps ON ps.storage_key = s.photo_storage_key WHERE s.phone_number = ?`).get('+15551001001') as any;
    expect(row.photo_status).toBe('PENDING_REVIEW');
    expect(row.status).toBe('PENDING_REVIEW');

    const file = getDb().prepare(`SELECT storage_key FROM student_photo_submissions ORDER BY submitted_at DESC LIMIT 1`).get() as any;
    expect(fs.existsSync(path.resolve(config.photoStorageDir, file.storage_key))).toBe(true);

    const history = SimulatorProvider.getHistory('+15551001001');
    expect(history.some(m => (m.text || '').includes('PENDING REVIEW'))).toBe(true);
  });

  it('does not store photographs for unknown WhatsApp senders', async () => {
    const before = (getDb().prepare('SELECT count(*) c FROM student_photo_submissions').get() as any).c;
    mockMediaDownload(validPng());
    await ConversationHandler.processIncomingMessage({ messageId: 'wamid-img-unknown', from: '+19990001111', image: { id: 'media-x' } });
    const after = (getDb().prepare('SELECT count(*) c FROM student_photo_submissions').get() as any).c;
    expect(after).toBe(before);
    expect(SimulatorProvider.getHistory('+19990001111').some(m => (m.text || '').includes('not linked'))).toBe(true);
  });

  it('safely handles ambiguous phone matches without storing', async () => {
    getDb().prepare(`INSERT INTO students (id, full_name, phone_number, gender, department, academic_level, preferred_occupancy, roommate_mode, consent_random_matching, created_at, updated_at) VALUES (?, ?, ?, 'MALE', 'Physics', '100 Level', 1, 'KNOWN', 0, datetime('now'), datetime('now'))`).run('stu-ambiguous', 'Ambiguous Person', '15551001001');
    const before = (getDb().prepare('SELECT count(*) c FROM student_photo_submissions').get() as any).c;
    mockMediaDownload(validPng());
    await ConversationHandler.processIncomingMessage({ messageId: 'wamid-img-amb', from: '15551001001', image: { id: 'media-amb' } });
    const after = (getDb().prepare('SELECT count(*) c FROM student_photo_submissions').get() as any).c;
    expect(after).toBe(before);
  });

  it('rejects invalid image bytes without creating a review record', async () => {
    const before = (getDb().prepare('SELECT count(*) c FROM student_photo_submissions').get() as any).c;
    mockMediaDownload(Buffer.from('not-an-image'), 'image/png');
    givenDisclosure();
    await ConversationHandler.processIncomingMessage({ messageId: 'wamid-img-bad', from: '+15551001001', image: { id: 'media-bad' } });
    const after = (getDb().prepare('SELECT count(*) c FROM student_photo_submissions').get() as any).c;
    expect(after).toBe(before);
    expect(SimulatorProvider.getHistory('+15551001001').some(m => (m.text || '').includes('JPEG'))).toBe(true);
  });

  it('rejects oversized downloads and failed media retrieval', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('graph.facebook.com')) {
        return { ok: true, json: async () => ({ url: 'https://example.com/big', mime_type: 'image/jpeg', file_size: 6 * 1024 * 1024 }) } as any;
      }
      throw new Error('unreachable');
    }));
    const before = (getDb().prepare('SELECT count(*) c FROM student_photo_submissions').get() as any).c;
    givenDisclosure();
    await ConversationHandler.processIncomingMessage({ messageId: 'wamid-img-big', from: '+15551001001', image: { id: 'media-big' } });
    const after = (getDb().prepare('SELECT count(*) c FROM student_photo_submissions').get() as any).c;
    expect(after).toBe(before);
  });

  it('is idempotent for repeated WhatsApp image message IDs', async () => {
    mockMediaDownload(validPng());
    givenDisclosure();
    await ConversationHandler.processIncomingMessage({ messageId: 'wamid-img-dup', from: '+15551001001', image: { id: 'media-dup' } });
    const once = (getDb().prepare('SELECT count(*) c FROM student_photo_submissions').get() as any).c;
    await ConversationHandler.processIncomingMessage({ messageId: 'wamid-img-dup', from: '+15551001001', image: { id: 'media-dup' } });
    const twice = (getDb().prepare('SELECT count(*) c FROM student_photo_submissions').get() as any).c;
    expect(twice).toBe(once);
  });

  it('surfaces WhatsApp photos in the manager pending review queue', async () => {
    mockMediaDownload(validPng());
    givenDisclosure();
    await ConversationHandler.processIncomingMessage({ messageId: 'wamid-img-queue', from: '+15551001001', image: { id: 'media-q' } });
    const queue = StudentPhotoService.getReviewQueue('PENDING_REVIEW');
    expect(queue.some((r: any) => r.phone_number === '+15551001001')).toBe(true);
  });

  it('requires configured media credentials instead of failing silently', async () => {
    config.meta.accessToken = '';
    await expect(WhatsAppMediaService.getMediaDownload({ id: 'media-noauth' })).rejects.toThrow();
  });
});
