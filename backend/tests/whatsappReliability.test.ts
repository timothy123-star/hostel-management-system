import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSeed } from '../src/db/seed.js';
import { getDb } from '../src/db/connection.js';
import { ConversationHandler } from '../src/services/whatsapp/conversationHandler.js';
import { SimulatorProvider } from '../src/services/whatsapp/simulatorProvider.js';
import { WhatsAppService } from '../src/services/whatsapp/whatsappService.js';
import { StudentService } from '../src/services/studentService.js';
import {
  enqueueInboundMessage,
  getInboxRecord,
  processInboxMessage,
  processPendingInbox,
  recoverAbandonedInbox,
} from '../src/services/whatsapp/whatsappInbox.js';

function msg(phone: string, tag: string, body: Partial<{ textBody: string; buttonId: string }>) {
  return { messageId: `${phone}-${tag}`, from: phone, ...body };
}

async function driveToRandomConsent(phone: string) {
  await ConversationHandler.processIncomingMessage(msg(phone, 'r1', { textBody: 'BOOK' }));
  await ConversationHandler.processIncomingMessage(msg(phone, 'r2', { textBody: 'Consent Tester' }));
  await ConversationHandler.processIncomingMessage(msg(phone, 'r3', { buttonId: 'gender_male' }));
  await ConversationHandler.processIncomingMessage(msg(phone, 'r4', { textBody: 'Physics' }));
  await ConversationHandler.processIncomingMessage(msg(phone, 'r5', { textBody: '300 Level' }));
  await ConversationHandler.processIncomingMessage(msg(phone, 'r6', { buttonId: 'occ_2' }));
  await ConversationHandler.processIncomingMessage(msg(phone, 'r7', { buttonId: 'mode_random' }));
  expect(ConversationHandler.getConversation(phone).state).toBe('AWAITING_RANDOM_CONSENT');
}

async function driveToRoommateChoice(phone: string) {
  await ConversationHandler.processIncomingMessage(msg(phone, 'm1', { textBody: 'BOOK' }));
  await ConversationHandler.processIncomingMessage(msg(phone, 'm2', { textBody: 'Roommate Tester' }));
  await ConversationHandler.processIncomingMessage(msg(phone, 'm3', { buttonId: 'gender_female' }));
  await ConversationHandler.processIncomingMessage(msg(phone, 'm4', { textBody: 'Economics' }));
  await ConversationHandler.processIncomingMessage(msg(phone, 'm5', { textBody: '200 Level' }));
  await ConversationHandler.processIncomingMessage(msg(phone, 'm6', { buttonId: 'occ_2' }));
  expect(ConversationHandler.getConversation(phone).state).toBe('AWAITING_ROOMMATE_CHOICE');
}

function sqliteTs(date = new Date()): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function seedConversation(phoneKey: string, state: string, payload: object, activeAt?: string) {
  const at = activeAt ?? sqliteTs();
  getDb()
    .prepare(
      `INSERT INTO whatsapp_conversations (id, phone_number, current_state, state_payload, last_active_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(`conv-${phoneKey}-${state}`, phoneKey, state, JSON.stringify(payload), at, at, at);
}

function conversationRows(phoneKey: string) {
  return getDb().prepare('SELECT * FROM whatsapp_conversations WHERE phone_number = ?').all(phoneKey) as any[];
}

beforeEach(async () => {
  await runSeed(true);
  WhatsAppService.setForceSimulator(true);
  SimulatorProvider.clearHistory();
});

describe('P1 exact consent interpretation', () => {
  it.each([
    ['YES via text', { textBody: 'YES' }],
    ['Y via text', { textBody: 'Y' }],
    ['I CONSENT via text', { textBody: 'I CONSENT' }],
    ['button consent_yes', { buttonId: 'consent_yes' }],
  ])('grants consent for an explicit affirmative (%s)', async (_label, body) => {
    const phone = `+1555222${String(Math.floor(Math.random() * 9000) + 1000)}`;
    await driveToRandomConsent(phone);
    await ConversationHandler.processIncomingMessage(msg(phone, 'yes', body));
    const stored = StudentService.getStudentByPhone(phone);
    expect(stored?.consent_random_matching).toBe(1);
  });

  it.each([
    ['NO', { textBody: 'NO' }],
    ['N', { textBody: 'N' }],
    ['NO CONSENT', { textBody: 'NO CONSENT' }],
    ['I DO NOT CONSENT', { textBody: 'I DO NOT CONSENT' }],
    ['button consent_no', { buttonId: 'consent_no' }],
  ])('treats %s as refusal, never granting consent', async (label, body) => {
    const phone = `+1555233${String(Math.floor(Math.random() * 9000) + 1000)}`;
    await driveToRandomConsent(phone);
    await ConversationHandler.processIncomingMessage(msg(phone, 'no', body));
    expect(StudentService.getStudentByPhone(phone)).toBeNull();
    expect(ConversationHandler.getConversation(phone).state).toBe('IDLE');
  });

  it.each([['CONSENT alone', 'CONSENT'], ['MAYBE', 'MAYBE'], ['CONSENT??', 'CONSENT??']])(
    'reprompts on ambiguous input (%s) without deciding',
    async (_label, text) => {
      const phone = `+1555244${String(Math.floor(Math.random() * 9000) + 1000)}`;
      await driveToRandomConsent(phone);
      await ConversationHandler.processIncomingMessage(msg(phone, 'amb', { textBody: text }));
      expect(StudentService.getStudentByPhone(phone)).toBeNull();
      expect(ConversationHandler.getConversation(phone).state).toBe('AWAITING_RANDOM_CONSENT');
      const history = SimulatorProvider.getHistory(phone);
      expect(history.some((m) => (m.text || '').includes('YES') && (m.text || '').includes('NO'))).toBe(true);
    },
  );
});

describe('P4 exact roommate-choice tokens', () => {
  it.each([[ 'KNOWN', { textBody: 'KNOWN' }], ['KNOWN ROOMMATES', { textBody: 'KNOWN ROOMMATES' }], ['button', { buttonId: 'mode_known' }]])(
    'selects KNOWN for %s',
    async (_label, body) => {
      const phone = `+1555255${String(Math.floor(Math.random() * 9000) + 1000)}`;
      await driveToRoommateChoice(phone);
      await ConversationHandler.processIncomingMessage(msg(phone, 'k', body));
      expect(ConversationHandler.getConversation(phone).state).toBe('AWAITING_INVITE_CODE');
    },
  );

  it.each([[ 'RANDOM', { textBody: 'RANDOM' }], ['RANDOM MATCHING', { textBody: 'RANDOM MATCHING' }], ['button', { buttonId: 'mode_random' }]])(
    'selects RANDOM for %s',
    async (_label, body) => {
      const phone = `+1555266${String(Math.floor(Math.random() * 9000) + 1000)}`;
      await driveToRoommateChoice(phone);
      await ConversationHandler.processIncomingMessage(msg(phone, 'r', body));
      expect(ConversationHandler.getConversation(phone).state).toBe('AWAITING_RANDOM_CONSENT');
    },
  );

  it.each([['UNKNOWN', 'UNKNOWN'], ['RANDOMIZED', 'RANDOMIZED'], ['MAYBE', 'MAYBE']])(
    'reprompts on %s without choosing a mode',
    async (_label, text) => {
      const phone = `+1555277${String(Math.floor(Math.random() * 9000) + 1000)}`;
      await driveToRoommateChoice(phone);
      await ConversationHandler.processIncomingMessage(msg(phone, 'u', { textBody: text }));
      const conv = ConversationHandler.getConversation(phone);
      expect(conv.state).toBe('AWAITING_ROOMMATE_CHOICE');
      expect(conv.payload.roommate_mode).toBeUndefined();
    },
  );
});

describe('P2 conversation compatibility across canonicalization', () => {
  it('resumes a bare-digits conversation when the canonical number arrives', async () => {
    const legacy = '2348012340101';
    const canonical = '+2348012340101';
    seedConversation(legacy, 'AWAITING_GENDER', { full_name: 'Legacy User' });
    await ConversationHandler.processIncomingMessage({ messageId: 'mig-1', from: canonical, textBody: 'MALE' });
    const conv = ConversationHandler.getConversation(canonical);
    expect(conv.state).toBe('AWAITING_DEPT');
    expect(conv.payload.full_name).toBe('Legacy User');
    expect(conversationRows(canonical).length).toBe(1);
    expect(conversationRows(legacy).length).toBe(0);
  });

  it('resumes a formatted legacy conversation number', async () => {
    const legacy = '(234) 801-234-0102';
    const canonical = '+2348012340102';
    seedConversation(legacy, 'AWAITING_DEPT', { full_name: 'Formatted User', gender: 'FEMALE' });
    await ConversationHandler.processIncomingMessage({ messageId: 'mig-2', from: canonical, textBody: 'Economics' });
    const conv = ConversationHandler.getConversation(canonical);
    expect(conv.state).toBe('AWAITING_LEVEL');
    expect(conv.payload).toMatchObject({ full_name: 'Formatted User', gender: 'FEMALE', department: 'Economics' });
    expect(conversationRows(canonical).length).toBe(1);
  });

  it('persists the next update to the migrated canonical record', async () => {
    const legacy = '2348012340103';
    const canonical = '+2348012340103';
    seedConversation(legacy, 'AWAITING_GENDER', { full_name: 'Update User' });
    await ConversationHandler.processIncomingMessage({ messageId: 'mig-3', from: canonical, textBody: 'FEMALE' });
    await ConversationHandler.processIncomingMessage({ messageId: 'mig-4', from: canonical, textBody: 'Biology' });
    const rows = conversationRows(canonical);
    expect(rows.length).toBe(1);
    expect(JSON.parse(rows[0].state_payload)).toMatchObject({ full_name: 'Update User', department: 'Biology' });
    expect(ConversationHandler.getConversation(canonical).state).toBe('AWAITING_LEVEL');
  });

  it('keeps an existing canonical record without duplicating it', async () => {
    const canonical = '+2348012340104';
    await ConversationHandler.processIncomingMessage({ messageId: 'mig-5', from: canonical, textBody: 'BOOK' });
    await ConversationHandler.processIncomingMessage({ messageId: 'mig-6', from: canonical, textBody: 'Canonical User' });
    expect(conversationRows(canonical).length).toBe(1);
    expect(ConversationHandler.getConversation(canonical).state).toBe('AWAITING_GENDER');
  });

  it('keeps the more advanced state when legacy and canonical rows collide', async () => {
    const legacy = '2348012340105';
    const canonical = '+2348012340105';
    seedConversation(legacy, 'AWAITING_GENDER', { full_name: 'Advanced User' }, sqliteTs(new Date(Date.now() - 2 * 3600 * 1000)));
    seedConversation(canonical, 'IDLE', {}, 'now');
    await ConversationHandler.processIncomingMessage({ messageId: 'mig-7', from: canonical, textBody: 'MALE' });
    const conv = ConversationHandler.getConversation(canonical);
    expect(conv.state).toBe('AWAITING_DEPT');
    expect(conv.payload.full_name).toBe('Advanced User');
    const all = getDb().prepare('SELECT * FROM whatsapp_conversations WHERE phone_number IN (?, ?)').all(legacy, canonical) as any[];
    expect(all.length).toBe(1);
    expect(all[0].phone_number).toBe(canonical);
  });
});

describe('P3 durable inbox worker', () => {
  it('processes a persisted message exactly once on duplicate delivery', async () => {
    const inbound = { messageId: 'inbox-dup-1', from: '+15553330001', textBody: 'MENU' };
    expect(enqueueInboundMessage(inbound)).toBe('enqueued');
    expect(enqueueInboundMessage(inbound)).toBe('duplicate');
    const totals = await processPendingInbox(10);
    expect(totals.processed).toBe(1);
    expect(getInboxRecord('inbox-dup-1')?.status).toBe('PROCESSED');
    // A redelivered batch finds nothing due and sends no second reply.
    const again = await processPendingInbox(10);
    expect(again).toMatchObject({ processed: 0, retryable: 0, failed: 0, skipped: 0 });
    expect(SimulatorProvider.getHistory('+15553330001').length).toBe(1);
  });

  it('leaves no permanent processed marker when handling throws, then recovers on retry', async () => {
    const inbound = { messageId: 'inbox-fail-1', from: '+15553330002', textBody: 'MENU' };
    enqueueInboundMessage(inbound);
    const spy = vi.spyOn(ConversationHandler, 'processIncomingMessage').mockRejectedValueOnce(new Error('boom'));
    try {
      expect(await processInboxMessage('inbox-fail-1')).toBe('retryable');
    } finally {
      spy.mockRestore();
    }
    const row = getInboxRecord('inbox-fail-1');
    expect(row?.status).toBe('RETRYABLE');
    expect(row?.attempts).toBe(1);
    expect(String(row?.last_error)).toContain('boom');
    expect(
      getDb().prepare('SELECT id FROM whatsapp_processed_messages WHERE message_id = ?').get('inbox-fail-1'),
    ).toBeUndefined();
    // Make the backoff due and retry: the message now completes normally.
    getDb().prepare(`UPDATE whatsapp_inbound_inbox SET next_attempt_at = '2000-01-01' WHERE message_id = ?`).run('inbox-fail-1');
    expect(await processInboxMessage('inbox-fail-1')).toBe('processed');
    expect(getInboxRecord('inbox-fail-1')?.status).toBe('PROCESSED');
    expect(
      getDb().prepare('SELECT id FROM whatsapp_processed_messages WHERE message_id = ?').get('inbox-fail-1'),
    ).toBeDefined();
  });

  it('processes multiple messages in one payload independently', async () => {
    enqueueInboundMessage({ messageId: 'inbox-multi-1', from: '+15553330003', textBody: 'MENU' });
    enqueueInboundMessage({ messageId: 'inbox-multi-2', from: '+15553330004', textBody: 'HELP' });
    const totals = await processPendingInbox(10);
    expect(totals.processed).toBe(2);
    expect(SimulatorProvider.getHistory('+15553330003').length).toBeGreaterThan(0);
    expect(SimulatorProvider.getHistory('+15553330004').length).toBeGreaterThan(0);
  });

  it('never processes the same message concurrently', async () => {
    enqueueInboundMessage({ messageId: 'inbox-race-1', from: '+15553330005', textBody: 'MENU' });
    const [first, second] = await Promise.all([processInboxMessage('inbox-race-1'), processInboxMessage('inbox-race-1')]);
    expect([first, second].sort()).toEqual(['processed', 'skipped']);
    expect(SimulatorProvider.getHistory('+15553330005').length).toBe(1);
  });

  it('recovers abandoned PROCESSING rows after a restart without touching live rows', async () => {
    enqueueInboundMessage({ messageId: 'inbox-abandoned-1', from: '+15553330006', textBody: 'MENU' });
    getDb()
      .prepare(`UPDATE whatsapp_inbound_inbox SET status = 'PROCESSING', attempts = 1, updated_at = '2000-01-01' WHERE message_id = ?`)
      .run('inbox-abandoned-1');
    enqueueInboundMessage({ messageId: 'inbox-live-1', from: '+15553330007', textBody: 'MENU' });
    getDb().prepare(`UPDATE whatsapp_inbound_inbox SET status = 'PROCESSING', updated_at = datetime('now') WHERE message_id = ?`).run('inbox-live-1');
    expect(recoverAbandonedInbox()).toBe(1);
    expect(getInboxRecord('inbox-abandoned-1')?.status).toBe('RECEIVED');
    expect(getInboxRecord('inbox-live-1')?.status).toBe('PROCESSING');
    // A post-restart worker picks the recovered row back up.
    const totals = await processPendingInbox(10);
    expect(totals.processed).toBe(1);
    expect(getInboxRecord('inbox-abandoned-1')?.status).toBe('PROCESSED');
  });

  it('marks poison messages FAILED after bounded attempts with an observable error', async () => {
    enqueueInboundMessage({ messageId: 'inbox-poison-1', from: '+15553330008', textBody: 'MENU' });
    const spy = vi.spyOn(ConversationHandler, 'processIncomingMessage').mockRejectedValue(new Error('always boom'));
    try {
      let outcome = '';
      for (let i = 0; i < 6; i += 1) {
        getDb().prepare(`UPDATE whatsapp_inbound_inbox SET next_attempt_at = '2000-01-01' WHERE message_id = ?`).run('inbox-poison-1');
        outcome = await processInboxMessage('inbox-poison-1');
        if (outcome === 'failed') break;
      }
      expect(outcome).toBe('failed');
    } finally {
      spy.mockRestore();
    }
    const row = getInboxRecord('inbox-poison-1');
    expect(row?.status).toBe('FAILED');
    expect(String(row?.last_error)).toContain('always boom');
  });
});
