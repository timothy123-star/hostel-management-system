import crypto from 'crypto';
import { getDb } from '../../db/connection.js';
import { ConversationHandler } from './conversationHandler.js';

/**
 * Durable inbound WhatsApp message inbox with an autonomous worker.
 *
 * The Meta webhook persists every supported inbound message here BEFORE
 * sending HTTP 200. Persistence failure returns HTTP 500 so Meta retries
 * the batch later. A controlled worker then claims each record atomically,
 * runs it through ConversationHandler, and marks it PROCESSED only after
 * successful handling.
 *
 * Worker lifecycle: `startInboxWorker()` (called at server startup after
 * `recoverAbandonedInbox()`) kicks an immediate drain and then polls for
 * eligible RECEIVED / due RETRYABLE records on a bounded interval, so
 * retries never depend on new inbound webhooks. Webhook-triggered drains
 * and scheduled polls share one guarded cycle (`runInboxCycle`) and can
 * never overlap within this process. `stopInboxWorker()` halts polling
 * for shutdown and tests; an in-flight cycle always runs to completion.
 * Poll timers are unreferenced so they never keep the process alive.
 * Worker-level failures are caught and logged without killing the loop.
 *
 * Delivery semantics are at-least-once: a crash after the resident reply
 * is sent but before the PROCESSED marker is written will reprocess the
 * message on recovery (the ConversationHandler processed-marker makes the
 * re-run state-safe, but a duplicate resident-facing reply is possible in
 * that narrow window). Exactly-once delivery is NOT claimed.
 */

export type InboxStatus = 'RECEIVED' | 'PROCESSING' | 'PROCESSED' | 'RETRYABLE' | 'FAILED';

export interface InboxInbound {
  messageId: string;
  from: string;
  textBody?: string;
  buttonId?: string;
  image?: { id: string; mime_type?: string };
}

export interface InboxRecord {
  id: string;
  message_id: string;
  from_number: string;
  text_body: string | null;
  button_id: string | null;
  has_image: number;
  image_id: string | null;
  image_mime: string | null;
  message_type: string;
  status: InboxStatus;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

/** Attempts before a poison message moves to terminal FAILED. */
export const INBOX_MAX_ATTEMPTS = 5;
/** PROCESSING rows older than this are considered abandoned (crash) and recoverable. */
export const INBOX_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;
/** Base backoff between retries; multiplied by the attempt count. */
const INBOX_RETRY_BASE_MS = 60 * 1000;
/** Default worker poll interval. Override with WHATSAPP_INBOX_POLL_MS. */
const DEFAULT_INBOX_POLL_MS = 15 * 1000;
/** Default per-cycle batch bound. */
const DEFAULT_INBOX_BATCH_LIMIT = 50;

function inboxPollIntervalMs(): number {
  const raw = Number(process.env.WHATSAPP_INBOX_POLL_MS);
  if (Number.isFinite(raw) && raw >= 1000) return Math.floor(raw);
  return DEFAULT_INBOX_POLL_MS;
}

/**
 * SQLite-compatible UTC timestamp ('YYYY-MM-DD HH:MM:SS'). The inbox table
 * is also written with datetime('now'), which uses this space-separated
 * format; mixing it with ISO 'T' timestamps would break lexicographic
 * comparisons such as `updated_at < cutoff`.
 */
function sqliteNow(date = new Date()): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export function enqueueInboundMessage(inbound: InboxInbound): 'enqueued' | 'duplicate' {
  const db = getDb();
  try {
    db.prepare(
      `
      INSERT INTO whatsapp_inbound_inbox
        (id, message_id, from_number, text_body, button_id, has_image, image_id, image_mime, message_type, status, attempts, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED', 0, datetime('now'), datetime('now'))
      `,
    ).run(
      `wib-${crypto.randomUUID()}`,
      inbound.messageId,
      inbound.from,
      inbound.textBody ?? null,
      inbound.buttonId ?? null,
      inbound.image ? 1 : 0,
      inbound.image?.id ?? null,
      inbound.image?.mime_type ?? null,
      inbound.image ? 'image' : inbound.buttonId ? 'interactive' : 'text',
    );
    return 'enqueued';
  } catch (err: any) {
    // Meta redelivers batches; the UNIQUE(message_id) key dedupes them.
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE' || String(err?.message).includes('UNIQUE')) {
      return 'duplicate';
    }
    throw err;
  }
}

export function getInboxRecord(messageId: string): InboxRecord | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM whatsapp_inbound_inbox WHERE message_id = ?').get(messageId) as InboxRecord) ?? null;
}

/**
 * Atomically claims one record for processing. The single UPDATE succeeds
 * for exactly one worker, so the same message is never processed
 * concurrently even with overlapping webhook deliveries.
 */
function claimInboxMessage(messageId: string): InboxRecord | null {
  const db = getDb();
  const now = sqliteNow();
  const claimed = db
    .prepare(
      `
      UPDATE whatsapp_inbound_inbox
      SET status = 'PROCESSING', attempts = attempts + 1, updated_at = ?
      WHERE message_id = ? AND status IN ('RECEIVED', 'RETRYABLE')
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      `,
    )
    .run(now, messageId, now);
  if (claimed.changes === 0) return null;
  return db.prepare('SELECT * FROM whatsapp_inbound_inbox WHERE message_id = ?').get(messageId) as InboxRecord;
}

function markInboxProcessed(messageId: string) {
  const db = getDb();
  db.prepare(
    `UPDATE whatsapp_inbound_inbox SET status = 'PROCESSED', last_error = NULL, updated_at = ? WHERE message_id = ?`,
  ).run(sqliteNow(), messageId);
}

function markInboxFailure(record: InboxRecord, err: unknown) {
  const db = getDb();
  const attempts = record.attempts;
  const detail = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);
  if (attempts >= INBOX_MAX_ATTEMPTS) {
    db.prepare(
      `UPDATE whatsapp_inbound_inbox SET status = 'FAILED', last_error = ?, updated_at = ? WHERE message_id = ?`,
    ).run(detail, sqliteNow(), record.message_id);
  } else {
    const next = sqliteNow(new Date(Date.now() + INBOX_RETRY_BASE_MS * attempts));
    db.prepare(
      `UPDATE whatsapp_inbound_inbox SET status = 'RETRYABLE', next_attempt_at = ?, last_error = ?, updated_at = ? WHERE message_id = ?`,
    ).run(next, detail, sqliteNow(), record.message_id);
  }
}

export async function processInboxMessage(messageId: string): Promise<'processed' | 'retryable' | 'failed' | 'skipped'> {
  const claimed = claimInboxMessage(messageId);
  if (!claimed) return 'skipped';
  const inbound: InboxInbound = {
    messageId: claimed.message_id,
    from: claimed.from_number,
    ...(claimed.text_body != null ? { textBody: claimed.text_body } : {}),
    ...(claimed.button_id != null ? { buttonId: claimed.button_id } : {}),
    ...(claimed.has_image && claimed.image_id
      ? { image: { id: claimed.image_id, ...(claimed.image_mime ? { mime_type: claimed.image_mime } : {}) } }
      : {}),
  };
  try {
    await ConversationHandler.processIncomingMessage(inbound);
  } catch (err) {
    console.error(`[WhatsApp Inbox] Handling failed for ${messageId}; marked for retry.`);
    markInboxFailure(claimed, err);
    return claimed.attempts >= INBOX_MAX_ATTEMPTS ? 'failed' : 'retryable';
  }
  markInboxProcessed(messageId);
  return 'processed';
}

/** Processes due inbox records oldest-first. One failure never stops the batch. */
export async function processPendingInbox(limit = 50): Promise<{ processed: number; retryable: number; failed: number; skipped: number }> {
  const db = getDb();
  const now = sqliteNow();
  const due = db
    .prepare(
      `
      SELECT message_id FROM whatsapp_inbound_inbox
      WHERE status = 'RECEIVED' OR (status = 'RETRYABLE' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
      ORDER BY created_at ASC
      LIMIT ?
      `,
    )
    .all(now, limit) as { message_id: string }[];
  const totals = { processed: 0, retryable: 0, failed: 0, skipped: 0 };
  for (const row of due) {
    try {
      const outcome = await processInboxMessage(row.message_id);
      totals[outcome] += 1;
    } catch (err) {
      console.error(`[WhatsApp Inbox] Worker error for ${row.message_id}:`, err);
      totals.retryable += 1;
    }
  }
  return totals;
}

/**
 * Returns abandoned PROCESSING rows (worker crashed mid-handling) to
 * RECEIVED so they are picked up again. Runs at server startup and is
 * safe to call any time; genuinely in-flight rows younger than the
 * timeout are untouched.
 */
export function recoverAbandonedInbox(timeoutMs = INBOX_PROCESSING_TIMEOUT_MS): number {
  const db = getDb();
  const cutoff = sqliteNow(new Date(Date.now() - timeoutMs));
  const res = db
    .prepare(
      `UPDATE whatsapp_inbound_inbox SET status = 'RECEIVED', updated_at = ? WHERE status = 'PROCESSING' AND updated_at < ?`,
    )
    .run(sqliteNow(), cutoff);
  if (res.changes > 0) console.log(`[WhatsApp Inbox] Recovered ${res.changes} abandoned message(s).`);
  return Number(res.changes);
}

/* ------------------------------------------------------------------ */
/* Autonomous worker lifecycle                                         */
/* ------------------------------------------------------------------ */

let workerTimer: NodeJS.Timeout | null = null;
let workerCycleRunning = false;
let workerDrainRequested = false;
let workerStopped = true;

export interface InboxWorkerStatus {
  running: boolean;
  polling: boolean;
  pollIntervalMs: number;
}

/** True while the background poller is active (started, not stopped). */
export function isInboxWorkerRunning(): boolean {
  return !workerStopped && workerTimer !== null;
}

function clearWorkerTimer() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}

/**
 * Single guarded worker cycle. Concurrent callers (webhook wake-up and
 * scheduled poll) coalesce: only one cycle executes at a time, and a
 * drain requested mid-cycle triggers exactly one follow-up pass.
 */
export async function runInboxCycle(limit = DEFAULT_INBOX_BATCH_LIMIT): Promise<void> {
  // Direct invocation always processes (tests, webhook path) even when the
  // background poller is stopped; the guard below prevents overlap.
  if (workerCycleRunning) {
    workerDrainRequested = true;
    return;
  }
  workerCycleRunning = true;
  try {
    do {
      workerDrainRequested = false;
      await processPendingInbox(limit);
    } while (workerDrainRequested && !workerStopped);
  } catch (err) {
    console.error('[WhatsApp Inbox] Worker cycle failed:', err);
  } finally {
    workerCycleRunning = false;
  }
}

/** Wake-up signal after enqueue; processing never depends on it succeeding. */
export function requestInboxDrain(): void {
  workerDrainRequested = true;
  if (!workerCycleRunning && !workerStopped) {
    void runInboxCycle();
  }
}

/**
 * Starts the autonomous poller: immediate drain, then bounded polling.
 * Idempotent. Safe to call after `recoverAbandonedInbox()` at startup.
 */
export function startInboxWorker(options?: { pollIntervalMs?: number; batchLimit?: number }): InboxWorkerStatus {
  const pollIntervalMs = options?.pollIntervalMs ?? inboxPollIntervalMs();
  const batchLimit = options?.batchLimit ?? DEFAULT_INBOX_BATCH_LIMIT;
  workerStopped = false;
  if (!workerTimer) {
    const interval = Math.max(1000, Math.floor(pollIntervalMs));
    workerTimer = setInterval(() => {
      void runInboxCycle(batchLimit).catch((err) => {
        console.error('[WhatsApp Inbox] Scheduled cycle failed:', err);
      });
    }, interval);
    // Never keep the process alive for polling alone.
    if (typeof (workerTimer as any)?.unref === 'function') (workerTimer as any).unref();
  }
  // Immediate drain without waiting for another inbound webhook.
  void runInboxCycle(batchLimit).catch((err) => {
    console.error('[WhatsApp Inbox] Startup drain failed:', err);
  });
  return { running: true, polling: workerTimer !== null, pollIntervalMs };
}

/**
 * Stops background polling for shutdown and tests. An in-flight cycle
 * runs to completion; no new cycle starts afterwards.
 */
export function stopInboxWorker(): void {
  workerStopped = true;
  workerDrainRequested = false;
  clearWorkerTimer();
}

/** Test/shutdown helper: waits until any in-flight cycle finishes. */
export async function waitForInboxIdle(timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (workerCycleRunning) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for inbox worker idle');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/* ------------------------------------------------------------------ */
/* Operational visibility (manager-authorized callers only)            */
/* ------------------------------------------------------------------ */

export interface InboxFailureRecord {
  message_id: string;
  from_number: string;
  message_type: string;
  status: InboxStatus;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface InboxFailureReport {
  failed_count: number;
  retryable_count: number;
  received_count: number;
  failures: InboxFailureRecord[];
  limit: number;
  offset: number;
}

/**
 * Counts outstanding records by status. Cheap index-backed aggregates for
 * the manager operational view.
 */
export function getInboxCounts(): { received: number; retryable: number; failed: number; processing: number } {
  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT
        SUM(CASE WHEN status = 'RECEIVED' THEN 1 ELSE 0 END) AS received,
        SUM(CASE WHEN status = 'RETRYABLE' THEN 1 ELSE 0 END) AS retryable,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 'PROCESSING' THEN 1 ELSE 0 END) AS processing
      FROM whatsapp_inbound_inbox
      `,
    )
    .get() as any;
  return {
    received: Number(row?.received ?? 0),
    retryable: Number(row?.retryable ?? 0),
    failed: Number(row?.failed ?? 0),
    processing: Number(row?.processing ?? 0),
  };
}

/**
 * Paginated terminal FAILED records. Message text/button payloads are
 * deliberately excluded: managers need routing metadata and errors, not
 * resident message contents. Errors are already bounded at write time.
 */
export function listInboxFailures(limit = 50, offset = 0): InboxFailureReport {
  const safeLimit = Math.min(Math.max(Math.floor(limit) || 50, 1), 100);
  const safeOffset = Math.max(Math.floor(offset) || 0, 0);
  const db = getDb();
  const counts = getInboxCounts();
  const failures = db
    .prepare(
      `
      SELECT message_id, from_number, message_type, status, attempts,
             next_attempt_at, last_error, created_at, updated_at
      FROM whatsapp_inbound_inbox
      WHERE status = 'FAILED'
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
      `,
    )
    .all(safeLimit, safeOffset) as InboxFailureRecord[];
  return {
    failed_count: counts.failed,
    retryable_count: counts.retryable,
    received_count: counts.received,
    failures,
    limit: safeLimit,
    offset: safeOffset,
  };
}
