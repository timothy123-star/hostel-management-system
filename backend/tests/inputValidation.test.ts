import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { runSeed } from '../src/db/seed.js';
import { getDb } from '../src/db/connection.js';
import { ConversationHandler } from '../src/services/whatsapp/conversationHandler.js';
import { SimulatorProvider } from '../src/services/whatsapp/simulatorProvider.js';
import { StudentService } from '../src/services/studentService.js';
import { WhatsAppService } from '../src/services/whatsapp/whatsappService.js';
import { config } from '../src/config.js';
import { extractInboundMessage, isSimulatorRequestAllowed } from '../src/routes/whatsappRoutes.js';
import { StudentRegistrationSchema, WhatsAppWebhookSchema } from '@hostel/shared';

const originalSecret = config.meta.appSecret;

function validBase(phone: string) {
  return {
    full_name: 'Test Resident',
    phone_number: phone,
    gender: 'MALE' as const,
    department: 'Computer Science',
    academic_level: '100 Level',
    preferred_occupancy: 1 as const,
    roommate_mode: 'KNOWN' as const,
    consent_random_matching: false,
  };
}

async function driveSingle(phone: string, name: string, genderButton: 'gender_male' | 'gender_female' = 'gender_female') {
  await ConversationHandler.processIncomingMessage({ messageId: `${phone}-s1`, from: phone, textBody: 'BOOK' });
  await ConversationHandler.processIncomingMessage({ messageId: `${phone}-s2`, from: phone, textBody: name });
  await ConversationHandler.processIncomingMessage({ messageId: `${phone}-s3`, from: phone, buttonId: genderButton });
  await ConversationHandler.processIncomingMessage({ messageId: `${phone}-s4`, from: phone, textBody: 'Computer Science' });
  await ConversationHandler.processIncomingMessage({ messageId: `${phone}-s5`, from: phone, textBody: '200 Level' });
  await ConversationHandler.processIncomingMessage({ messageId: `${phone}-s6`, from: phone, buttonId: 'occ_1' });
}

async function driveToInviteCode(phone: string) {
  await ConversationHandler.processIncomingMessage({ messageId: `${phone}-i1`, from: phone, textBody: 'BOOK' });
  await ConversationHandler.processIncomingMessage({ messageId: `${phone}-i2`, from: phone, textBody: 'Invite Tester' });
  await ConversationHandler.processIncomingMessage({ messageId: `${phone}-i3`, from: phone, buttonId: 'gender_male' });
  await ConversationHandler.processIncomingMessage({ messageId: `${phone}-i4`, from: phone, textBody: 'Physics' });
  await ConversationHandler.processIncomingMessage({ messageId: `${phone}-i5`, from: phone, textBody: '300 Level' });
  await ConversationHandler.processIncomingMessage({ messageId: `${phone}-i6`, from: phone, buttonId: 'occ_2' });
  await ConversationHandler.processIncomingMessage({ messageId: `${phone}-i7`, from: phone, buttonId: 'mode_known' });
}

beforeEach(async () => {
  await runSeed(true);
  WhatsAppService.setForceSimulator(true);
  SimulatorProvider.clearHistory();
});

afterEach(() => {
  config.meta.appSecret = originalSecret;
  vi.restoreAllMocks();
});

describe('registration free-text normalization', () => {
  it('keeps a lowercase name lowercase in storage and retrieval', async () => {
    const phone = '+18881110001';
    await driveSingle(phone, 'adaeze okafor');
    const stored = StudentService.getStudentByPhone(phone);
    expect(stored?.full_name).toBe('adaeze okafor');
    const row = getDb().prepare('SELECT full_name FROM students WHERE phone_number = ?').get('+18881110001') as any;
    expect(row.full_name).toBe('adaeze okafor');
  });

  it('preserves mixed case without title-casing', async () => {
    const phone = '+18881110002';
    await driveSingle(phone, "McDonald O'Brien-Smith");
    expect(StudentService.getStudentByPhone(phone)?.full_name).toBe("McDonald O'Brien-Smith");
  });

  it('trims and collapses repeated whitespace', async () => {
    const phone = '+18881110003';
    await driveSingle(phone, '  Adaeze   Okafor  ');
    expect(StudentService.getStudentByPhone(phone)?.full_name).toBe('Adaeze Okafor');
  });

  it('accepts accents and legitimate non-Latin scripts', async () => {
    const phone = '+18881110004';
    await driveSingle(phone, 'José García');
    expect(StudentService.getStudentByPhone(phone)?.full_name).toBe('José García');
    const phone2 = '+18881110005';
    await driveSingle(phone2, '王小明');
    expect(StudentService.getStudentByPhone(phone2)?.full_name).toBe('王小明');
  });

  it('rejects excessively long names at the conversation and service layers', async () => {
    const phone = '+18881110006';
    await ConversationHandler.processIncomingMessage({ messageId: `${phone}-b1`, from: phone, textBody: 'BOOK' });
    await ConversationHandler.processIncomingMessage({ messageId: `${phone}-b2`, from: phone, textBody: 'a'.repeat(101) });
    const history = SimulatorProvider.getHistory(phone);
    expect(history.some((m) => (m.text || '').includes('100 characters'))).toBe(true);
    expect(ConversationHandler.getConversation(phone).state).toBe('AWAITING_NAME');
    expect(StudentService.getStudentByPhone(phone)).toBeNull();
    expect(() =>
      StudentService.registerStudent({ ...validBase('+18881110007'), full_name: 'a'.repeat(101) }),
    ).toThrow(/100 characters/);
  });

  it('rejects control characters but allows zero-width joiners', async () => {
    expect(StudentRegistrationSchema.safeParse({ ...validBase('+18881110008'), full_name: 'Bad\u0007Name' }).success).toBe(false);
    const zwj = StudentRegistrationSchema.safeParse({ ...validBase('+18881110009'), full_name: 'Asha\u200DTest' });
    expect(zwj.success).toBe(true);
    const stored = StudentService.registerStudent({ ...validBase('+18881110009'), full_name: 'Asha\u200DTest' });
    expect(stored.student.full_name).toBe('Asha\u200DTest');
  });
});

describe('shared registration contract', () => {
  it('rejects invalid gender, occupancy and roommate values on both paths', async () => {
    expect(() =>
      StudentService.registerStudent({ ...validBase('+18881120001'), gender: 'OTHER' as any }),
    ).toThrow();
    expect(() =>
      StudentService.registerStudent({ ...validBase('+18881120002'), preferred_occupancy: 5 as any }),
    ).toThrow();
    expect(() =>
      StudentService.registerStudent({ ...validBase('+18881120003'), roommate_mode: 'MAYBE' as any }),
    ).toThrow();

    const phone = '+18881120004';
    await driveSingle(phone, 'Contract Tester', 'gender_male');
    const stored = StudentService.getStudentByPhone(phone);
    expect(stored?.gender).toBe('MALE');
    // A direct WhatsApp gender synonym still lands on the canonical enum.
    const phone2 = '+18881120005';
    await ConversationHandler.processIncomingMessage({ messageId: `${phone2}-g1`, from: phone2, textBody: 'BOOK' });
    await ConversationHandler.processIncomingMessage({ messageId: `${phone2}-g2`, from: phone2, textBody: 'Gender Synonym' });
    await ConversationHandler.processIncomingMessage({ messageId: `${phone2}-g3`, from: phone2, textBody: 'M' });
    await ConversationHandler.processIncomingMessage({ messageId: `${phone2}-g4`, from: phone2, textBody: 'History' });
    await ConversationHandler.processIncomingMessage({ messageId: `${phone2}-g5`, from: phone2, textBody: '100 Level' });
    await ConversationHandler.processIncomingMessage({ messageId: `${phone2}-g6`, from: phone2, buttonId: 'occ_1' });
    expect(StudentService.getStudentByPhone(phone2)?.gender).toBe('MALE');
  });

  it('never treats the string "false" as granted consent', () => {
    expect(() =>
      StudentService.registerStudent({
        ...validBase('+18881120006'),
        consent_random_matching: 'false' as any,
        roommate_mode: 'RANDOM' as any,
        preferred_occupancy: 2 as any,
      }),
    ).toThrow();
    expect(() =>
      StudentService.registerStudent({ ...validBase('+18881120007'), auto_complete_triple_consent: 'false' as any }),
    ).toThrow();
  });

  it('rejects malformed invite codes in conversation and service', async () => {
    const phone = '+18881120008';
    await driveToInviteCode(phone);
    await ConversationHandler.processIncomingMessage({ messageId: `${phone}-i8`, from: phone, textBody: 'abcd' });
    const history = SimulatorProvider.getHistory(phone);
    expect(history.some((m) => (m.text || '').includes('GRP-XXXX'))).toBe(true);
    expect(StudentService.getStudentByPhone(phone)).toBeNull();
    expect(ConversationHandler.getConversation(phone).state).toBe('AWAITING_INVITE_CODE');
    expect(() =>
      StudentService.registerStudent({
        ...validBase('+18881120009'),
        roommate_mode: 'KNOWN',
        preferred_occupancy: 2,
        group_invite_code: 'GRP-BAD!',
      }),
    ).toThrow(/Invitation code/);
  });

  it('preserves valid group invite behavior end to end', async () => {
    const leader = StudentService.registerStudent({
      ...validBase('+18881120010'),
      roommate_mode: 'KNOWN',
      preferred_occupancy: 2,
    });
    expect(leader.group?.group_code).toMatch(/^GRP-[A-HJ-NP-Z2-9]{4}$/);
    const member = StudentService.registerStudent({
      ...validBase('+18881120011'),
      gender: leader.student.gender,
      roommate_mode: 'KNOWN',
      preferred_occupancy: 2,
      group_invite_code: leader.group.group_code.toLowerCase(),
    });
    expect(member.group?.group_code).toBe(leader.group?.group_code);
  });

  it('gives a useful WhatsApp correction instead of crashing on bad input', async () => {
    const phone = '+18881120012';
    await ConversationHandler.processIncomingMessage({ messageId: `${phone}-c1`, from: phone, textBody: 'BOOK' });
    await ConversationHandler.processIncomingMessage({ messageId: `${phone}-c2`, from: phone, textBody: 'x' });
    const history = SimulatorProvider.getHistory(phone);
    const last = history[0];
    expect(last?.text || '').toMatch(/at least 2 characters|Full name/i);
    expect(ConversationHandler.getConversation(phone).state).toBe('AWAITING_NAME');
    expect(StudentService.getStudentByPhone(phone)).toBeNull();
  });
});

describe('canonical phone handling', () => {
  it('normalizes a Meta-format sender without a plus', async () => {
    await driveSingle('15550009991', 'Meta Format');
    const stored = getDb().prepare('SELECT phone_number FROM students WHERE id IS NOT NULL ORDER BY created_at DESC LIMIT 1').get() as any;
    expect(stored.phone_number).toBe('+15550009991');
    expect(StudentService.getStudentByPhone('15550009991')?.full_name).toBe('Meta Format');
    expect(StudentService.getStudentByPhone('+15550009991')?.full_name).toBe('Meta Format');
  });

  it('keeps canonical international numbers unchanged', async () => {
    await driveSingle('+15550009992', 'Canonical Keeper');
    expect(
      (getDb().prepare('SELECT phone_number FROM students WHERE full_name = ?').get('Canonical Keeper') as any).phone_number,
    ).toBe('+15550009992');
  });

  it('detects duplicates across old and new representations', async () => {
    StudentService.registerStudent(validBase('+18881130001'));
    expect(() => StudentService.registerStudent(validBase('18881130001'))).toThrow(/already registered/);
    expect(() => StudentService.registerStudent(validBase('+18881130001'))).toThrow(/already registered/);
  });

  it('rejects invalid phone numbers', () => {
    expect(() => StudentService.registerStudent(validBase('abc'))).toThrow(/phone/i);
    expect(() => StudentService.registerStudent(validBase('123'))).toThrow(/phone/i);
  });


  it('treats LIKE wildcards in manager search as literal text', () => {
    const all = StudentService.getStudents({});
    expect(all.length).toBeGreaterThan(0);
    expect(StudentService.getStudents({ search: '%' })).toEqual([]);
    expect(StudentService.getStudents({ search: '_' })).toEqual([]);
    expect(StudentService.getStudents({ search: '\\' })).toEqual([]);
    // Ordinary search still matches.
    const john = StudentService.getStudents({ search: 'John Doe', limit: 20 }).find((s) => s.id === 'stu-demo-01');
    expect(john?.full_name).toContain('John Doe');
  });

  it('retrieves legacy rows stored before canonicalization', async () => {
    getDb()
      .prepare(
        "INSERT INTO students (id, full_name, phone_number, gender, department, academic_level, preferred_occupancy, roommate_mode, consent_random_matching, created_at, updated_at) VALUES (?, ?, ?, 'MALE', 'Physics', '100 Level', 1, 'KNOWN', 0, datetime('now'), datetime('now'))",
      )
      .run('stu-legacy-1', 'Legacy Resident', '15551009991');
    expect(StudentService.getStudentByPhone('+15551009991')?.full_name).toBe('Legacy Resident');
    expect(StudentService.getStudentByPhone('15551009991')?.full_name).toBe('Legacy Resident');
  });
});


describe('webhook envelope and simulator hardening', () => {
  it('rejects missing secrets, malformed headers and wrong signatures', () => {
    const raw = Buffer.from(JSON.stringify({ hello: 'world' }));
    expect(ConversationHandler.validateSignature(raw, undefined)).toBe(false);
    expect(ConversationHandler.validateSignature(raw, ['a', 'b'] as any)).toBe(false);
    expect(ConversationHandler.validateSignature(raw, 'not-a-signature')).toBe(false);
    config.meta.appSecret = 'test-app-secret';
    expect(ConversationHandler.validateSignature(raw, 'sha256=' + 'a'.repeat(64))).toBe(false);
    const good = 'sha256=' + crypto.createHmac('sha256', 'test-app-secret').update(raw).digest('hex');
    expect(ConversationHandler.validateSignature(raw, good)).toBe(true);
    expect(ConversationHandler.validateSignature(undefined, good)).toBe(false);
  });

  it('extracts a valid Meta text message', () => {
    const inbound = extractInboundMessage({ id: 'w2', from: '15550000001', type: 'text', text: { body: 'MENU' } });
    expect(inbound).toMatchObject({ messageId: 'w2', from: '15550000001', textBody: 'MENU' });
  });

  it('extracts interactive, button and image payloads', () => {
    expect(
      extractInboundMessage({ id: 'i1', from: '15550000001', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'gender_male', title: 'Male Hostel' } } }),
    ).toMatchObject({ buttonId: 'gender_male', textBody: 'Male Hostel' });
    expect(
      extractInboundMessage({ id: 'i2', from: '15550000001', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'menu_status', title: 'Booking status' } } }),
    ).toMatchObject({ buttonId: 'menu_status', textBody: 'Booking status' });
    expect(
      extractInboundMessage({ id: 'im1', from: '15550000001', type: 'image', image: { id: 'media-1', mime_type: 'image/jpeg', caption: 'hi' } }),
    ).toMatchObject({ image: { id: 'media-1', mime_type: 'image/jpeg' }, textBody: 'hi' });
  });

  it('ignores unsupported message types instead of feeding empty text', () => {
    expect(extractInboundMessage({ id: 'w3', from: '15550000002', type: 'video' })).toBeNull();
    expect(extractInboundMessage({ id: 'w4', from: '15550000002', type: 'audio' })).toBeNull();
    expect(extractInboundMessage({ id: 'w5', from: '15550000002', type: 'sticker' })).toBeNull();
    // Interactive payloads without a usable reply are also unusable.
    expect(extractInboundMessage({ id: 'w6', from: '15550000002', type: 'interactive', interactive: { type: 'unknown_kind' } })).toBeNull();
    // Empty text bodies are not synthesized into state-machine input.
    expect(extractInboundMessage({ id: 'w7', from: '15550000002', type: 'text', text: { body: '' } })).toBeNull();
    expect(extractInboundMessage({ id: '', from: '15550000002', type: 'text', text: { body: 'MENU' } })).toBeNull();
  });

  it('validates envelopes while tolerating status-only and malformed bodies', () => {
    const textBody = { entry: [{ changes: [{ value: { messages: [{ id: 'w1', from: '1555', type: 'text', text: { body: 'MENU' } }] } }] }] };
    expect(WhatsAppWebhookSchema.safeParse(textBody).success).toBe(true);
    const statusOnly = { entry: [{ changes: [{ value: { statuses: [{ id: 'mid.1', status: 'delivered' }] } }] }] };
    const statusParsed = WhatsAppWebhookSchema.safeParse(statusOnly);
    expect(statusParsed.success).toBe(true);
    // A bare object ping carries no entries and is tolerated (nothing to process).
    expect(WhatsAppWebhookSchema.safeParse({ object: 'whatsapp_business_account' }).success).toBe(true);
    const malformed: any[] = [{ entry: 'nope' }, { entry: [{ changes: [{ value: null }] }] }, { entry: [{ changes: 'nope' }] }];
    for (const body of malformed) {
      expect(WhatsAppWebhookSchema.safeParse(body).success).toBe(false);
    }
    // Extra Meta fields never invalidate a legitimate payload.
    const extra = { entry: [{ changes: [{ value: { messages: [{ id: 'w9', from: '1555', type: 'text', text: { body: 'x' }, extra_field: 1 }], messaging_product: 'whatsapp' } }] }] };
    expect(WhatsAppWebhookSchema.safeParse(extra).success).toBe(true);
  });

  it('extracts every message in a batched delivery', () => {
    const body = {
      entry: [
        { changes: [{ value: { messages: [{ id: 'b1', from: '15550000003', type: 'text', text: { body: 'MENU' } }] } }] },
        { changes: [{ value: { messages: [{ id: 'b2', from: '15550000004', type: 'text', text: { body: 'STATUS' } }] } }] },
      ],
    };
    const parsed = WhatsAppWebhookSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const extracted: string[] = [];
    for (const entry of parsed.data.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const message of (change.value as any)?.messages ?? []) {
          const inbound = extractInboundMessage(message);
          if (inbound?.textBody) extracted.push(inbound.textBody);
        }
      }
    }
    expect(extracted).toEqual(['MENU', 'STATUS']);
  });

  it('keeps the simulator host-only while allowing local use', () => {
    expect(isSimulatorRequestAllowed({ ip: '127.0.0.1', socket: {} } as any)).toBe(true);
    const savedNodeEnv = process.env.NODE_ENV;
    const savedVitest = process.env.VITEST;
    delete (process.env as any).NODE_ENV;
    delete (process.env as any).VITEST;
    try {
      expect(isSimulatorRequestAllowed({ ip: '8.8.8.8', socket: { remoteAddress: '8.8.8.8' } } as any)).toBe(false);
      expect(isSimulatorRequestAllowed({ ip: '127.0.0.1', socket: {} } as any)).toBe(true);
      expect(isSimulatorRequestAllowed({ ip: '::1', socket: {} } as any)).toBe(true);
    } finally {
      if (savedNodeEnv !== undefined) process.env.NODE_ENV = savedNodeEnv;
      if (savedVitest !== undefined) process.env.VITEST = savedVitest;
    }
  });

  it('processes a Meta-format inbound end to end without HTTP', async () => {
    const inbound = extractInboundMessage({ id: 'e2e-1', from: '15550009993', type: 'text', text: { body: 'HELP' } });
    expect(inbound).not.toBeNull();
    await ConversationHandler.processIncomingMessage(inbound!);
    const history = SimulatorProvider.getHistory('+15550009993');
    expect(history.length).toBeGreaterThan(0);
  });
});
