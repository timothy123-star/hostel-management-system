import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSeed } from '../src/db/seed.js';
import { getDb } from '../src/db/connection.js';
import { ConversationHandler } from '../src/services/whatsapp/conversationHandler.js';
import { SimulatorProvider } from '../src/services/whatsapp/simulatorProvider.js';
import { WhatsAppService } from '../src/services/whatsapp/whatsappService.js';
import { authMiddleware } from '../src/middleware/authMiddleware.js';
import { whatsappRouter } from '../src/routes/whatsappRoutes.js';
import {
  enqueueInboundMessage,
  getInboxRecord,
  isInboxWorkerRunning,
  listInboxFailures,
  recoverAbandonedInbox,
  runInboxCycle,
  requestInboxDrain,
  startInboxWorker,
  stopInboxWorker,
  waitForInboxIdle,
} from '../src/services/whatsapp/whatsappInbox.js';

function sqliteTs(date = new Date()): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function seedInboxRow(messageId: string, from: string, status: string, nextAt: string | null, attempts = 1) {
  getDb()
    .prepare(
      `INSERT INTO whatsapp_inbound_inbox
        (id, message_id, from_number, text_body, button_id, has_image, message_type, status, attempts, next_attempt_at, last_error, created_at, updated_at)
       VALUES (?, ?, ?, 'MENU', NULL, 0, 'text', ?, ?, ?, 'boom', datetime('now'), datetime('now'))`,
    )
    .run(`wib-${messageId}`, messageId, from, status, attempts, nextAt);
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

beforeEach(async () => {
  await runSeed(true);
  stopInboxWorker();
  WhatsAppService.setForceSimulator(true);
  SimulatorProvider.clearHistory();
});

afterEach(async () => {
  stopInboxWorker();
  await waitForInboxIdle().catch(() => undefined);
  vi.restoreAllMocks();
});

describe('autonomous inbox worker lifecycle', () => {
  it('recovers an abandoned row at startup and drains it with no new webhook', async () => {
    enqueueInboundMessage({ messageId: 'life-restart-1', from: '+15554440001', textBody: 'MENU' });
    // Simulate a crash after ACK while the message was PROCESSING.
    getDb()
      .prepare(`UPDATE whatsapp_inbound_inbox SET status = 'PROCESSING', updated_at = '2000-01-01 00:00:00' WHERE message_id = ?`)
      .run('life-restart-1');
    expect(recoverAbandonedInbox()).toBe(1);
    expect(getInboxRecord('life-restart-1')?.status).toBe('RECEIVED');

    startInboxWorker();
    try {
      // Immediate startup drain: no webhook arrives in this test.
      for (let i = 0; i < 200 && getInboxRecord('life-restart-1')?.status !== 'PROCESSED'; i += 1) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(getInboxRecord('life-restart-1')?.status).toBe('PROCESSED');
      expect(SimulatorProvider.getHistory('+15554440001').length).toBeGreaterThan(0);
    } finally {
      stopInboxWorker();
    }
  });

  it('retries a due RETRYABLE message without any new inbound traffic', async () => {
    seedInboxRow('life-due-1', '+15554440002', 'RETRYABLE', '2000-01-01 00:00:00');
    await runInboxCycle();
    expect(getInboxRecord('life-due-1')?.status).toBe('PROCESSED');
    expect(SimulatorProvider.getHistory('+15554440002').length).toBeGreaterThan(0);
  });

  it('leaves a future RETRYABLE message untouched before its backoff expires', async () => {
    seedInboxRow('life-future-1', '+15554440003', 'RETRYABLE', sqliteTs(new Date(Date.now() + 3600 * 1000)));
    await runInboxCycle();
    const row = getInboxRecord('life-future-1');
    expect(row?.status).toBe('RETRYABLE');
    expect(row?.attempts).toBe(1);
    expect(SimulatorProvider.getHistory('+15554440003').length).toBe(0);
  });

  it('keeps polling after an individual processing failure', async () => {
    seedInboxRow('life-poison-1', '+15554440004', 'RECEIVED', null, 0);
    enqueueInboundMessage({ messageId: 'life-healthy-1', from: '+15554440005', textBody: 'MENU' });
    const spy = vi.spyOn(ConversationHandler, 'processIncomingMessage').mockImplementation(async (inbound: any) => {
      if (inbound.messageId === 'life-poison-1') throw new Error('poison');
      // Healthy path: record success without side effects.
    });
    try {
      await runInboxCycle();
    } finally {
      spy.mockRestore();
    }
    expect(getInboxRecord('life-poison-1')?.status).toBe('RETRYABLE');
    expect(getInboxRecord('life-healthy-1')?.status).toBe('PROCESSED');
  });

  it('never overlaps worker cycles between webhook wake-up and polling', async () => {
    enqueueInboundMessage({ messageId: 'life-overlap-1', from: '+15554440006', textBody: 'MENU' });
    let concurrent = 0;
    let maxConcurrent = 0;
    let calls = 0;
    const spy = vi.spyOn(ConversationHandler, 'processIncomingMessage').mockImplementation(async () => {
      calls += 1;
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 120));
      concurrent -= 1;
    });
    try {
      await Promise.all([runInboxCycle(), runInboxCycle(), (requestInboxDrain(), runInboxCycle())]);
    } finally {
      spy.mockRestore();
    }
    expect(maxConcurrent).toBe(1);
    expect(calls).toBe(1);
    expect(getInboxRecord('life-overlap-1')?.status).toBe('PROCESSED');
  });

  it('starts polling on demand and shuts down cleanly', async () => {
    expect(isInboxWorkerRunning()).toBe(false);
    const status = startInboxWorker({ pollIntervalMs: 1000 });
    expect(status.polling).toBe(true);
    expect(isInboxWorkerRunning()).toBe(true);
    stopInboxWorker();
    expect(isInboxWorkerRunning()).toBe(false);
    await waitForInboxIdle();
  });

  it('keeps FAILED records inspectable with bounded fields', async () => {
    seedInboxRow('life-fail-1', '+15554440007', 'FAILED', null, 5);
    seedInboxRow('life-fail-2', '+15554440008', 'FAILED', null, 5);
    seedInboxRow('life-fail-3', '+15554440009', 'FAILED', null, 5);
    const page1 = listInboxFailures(2, 0);
    expect(page1.failed_count).toBe(3);
    expect(page1.failures.length).toBe(2);
    expect(page1.limit).toBe(2);
    const page2 = listInboxFailures(2, 2);
    expect(page2.failures.length).toBe(1);
    for (const f of page1.failures) {
      expect(f).not.toHaveProperty('text_body');
      expect(f).not.toHaveProperty('button_id');
      expect(String(f.last_error ?? '')).toBe('boom');
      expect(f.message_id).toMatch(/^life-fail-/);
    }
  });
});

describe('manager visibility authorization', () => {
  function mockRes() {
    const res: any = { statusCode: 0, body: null };
    res.status = (c: number) => ((res.statusCode = c), res);
    res.json = (b: unknown) => ((res.body = b), res);
    return res;
  }

  it('rejects unauthenticated callers at the middleware', () => {
    const res = mockRes();
    let nexted = false;
    authMiddleware({ headers: {} } as any, res as any, () => {
      nexted = true;
    });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('rejects forged tokens at the middleware', () => {
    const res = mockRes();
    let nexted = false;
    authMiddleware({ headers: { authorization: 'Bearer invalid.token.here' } } as any, res as any, () => {
      nexted = true;
    });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('registers the failures endpoint behind the manager auth middleware', () => {
    const layer = (whatsappRouter.stack as any[]).find(
      (l) => l.route && l.route.path === '/inbox/failures' && l.route.methods?.get,
    );
    expect(layer).toBeDefined();
    const names = layer.route.stack.map((h: any) => h.name || h.handle?.name);
    expect(names).toContain('authMiddleware');
  });
});

describe('conversation collision resolution and archiving', () => {
  function archivesFor(phoneKey: string) {
    return getDb().prepare('SELECT * FROM whatsapp_conversation_archives WHERE phone_number = ?').all(phoneKey) as any[];
  }

  it('prefers an active row over IDLE and archives the loser', async () => {
    seedConversation('2348012340201', 'AWAITING_GENDER', { full_name: 'Active User' });
    seedConversation('+2348012340201', 'IDLE', {});
    await ConversationHandler.processIncomingMessage({ messageId: 'col-1', from: '+2348012340201', textBody: 'MALE' });
    const conv = ConversationHandler.getConversation('+2348012340201');
    expect(conv.state).toBe('AWAITING_DEPT');
    expect(conv.payload.full_name).toBe('Active User');
    const archived = archivesFor('+2348012340201');
    expect(archived.length).toBe(1);
    expect(archived[0]).toMatchObject({ current_state: 'IDLE' });
    expect(String(archived[0].reason)).toContain('AWAITING_GENDER');
  });

  it('prefers an older more-progressed row over a newer less-progressed row', async () => {
    seedConversation('2348012340202', 'AWAITING_INVITE_CODE', { full_name: 'Far Along', gender: 'MALE' }, sqliteTs(new Date(Date.now() - 7200 * 1000)));
    seedConversation('+2348012340202', 'AWAITING_GENDER', { full_name: 'Just Started' });
    const conv = ConversationHandler.getConversation('+2348012340202');
    expect(conv.state).toBe('AWAITING_INVITE_CODE');
    expect(conv.payload.full_name).toBe('Far Along');
    const archived = archivesFor('+2348012340202');
    expect(archived.length).toBe(1);
    expect(JSON.parse(archived[0].state_payload)).toMatchObject({ full_name: 'Just Started' });
  });

  it('archives the divergent loser when same-state rows conflict', () => {
    seedConversation('2348012340203', 'AWAITING_DEPT', { full_name: 'Old Name', gender: 'FEMALE' }, sqliteTs(new Date(Date.now() - 3600 * 1000)));
    seedConversation('+2348012340203', 'AWAITING_DEPT', { full_name: 'New Name', gender: 'FEMALE' });
    const conv = ConversationHandler.getConversation('+2348012340203');
    expect(conv.state).toBe('AWAITING_DEPT');
    expect(conv.payload.full_name).toBe('New Name');
    // The archive preserves the loser's original (legacy) key as provenance.
    const archived = getDb().prepare('SELECT * FROM whatsapp_conversation_archives').all() as any[];
    expect(archived.length).toBe(1);
    expect(archived[0].phone_number).toBe('2348012340203');
    expect(JSON.parse(archived[0].state_payload)).toMatchObject({ full_name: 'Old Name' });
    expect(String(archived[0].reason)).toContain('AWAITING_DEPT');
  });

  it('keeps the canonical winner row with its state and payload', async () => {
    seedConversation('2348012340204', 'AWAITING_LEVEL', { full_name: 'Winner', gender: 'MALE', department: 'Physics' });
    await ConversationHandler.processIncomingMessage({ messageId: 'col-4', from: '+2348012340204', textBody: '300 Level' });
    const rows = getDb().prepare('SELECT * FROM whatsapp_conversations WHERE phone_number = ?').all('+2348012340204') as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].current_state).toBe('AWAITING_OCCUPANCY');
    expect(JSON.parse(rows[0].state_payload)).toMatchObject({ full_name: 'Winner', department: 'Physics', academic_level: '300 Level' });
  });

  it('handles concurrent first-messages without corrupting the migration', async () => {
    const phone = '+15554440010';
    await Promise.all(
      [0, 1, 2, 3].map((i) =>
        ConversationHandler.processIncomingMessage({ messageId: `col-race-${i}`, from: phone, textBody: 'BOOK' }),
      ),
    );
    const rows = getDb().prepare('SELECT * FROM whatsapp_conversations WHERE phone_number = ?').all(phone) as any[];
    expect(rows.length).toBe(1);
    expect(ConversationHandler.getConversation(phone).state).toBe('AWAITING_NAME');
  });
});
