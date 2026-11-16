import { Router } from 'express';
import crypto from 'crypto';
import { ConversationHandler } from '../services/whatsapp/conversationHandler.js';
import { WhatsAppWebhookSchema } from '@hostel/shared';
import { WhatsAppService } from '../services/whatsapp/whatsappService.js';
import { SimulatorProvider } from '../services/whatsapp/simulatorProvider.js';
import { enqueueInboundMessage, listInboxFailures, runInboxCycle } from '../services/whatsapp/whatsappInbox.js';
import { authMiddleware, requireManager } from '../middleware/authMiddleware.js';
import { config } from '../config.js';

export const whatsappRouter = Router();

/**
 * 1. Meta Webhook Verification (GET Challenge)
 */
whatsappRouter.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.meta.verifyToken) {
    console.log('[Meta Webhook] GET Verification challenge successfully verified.');
    res.status(200).send(challenge);
  } else {
    console.warn('[Meta Webhook] Verification challenge failed. Invalid verify token.');
    res.status(403).json({ error: 'Verification failed' });
  }
});

/**
 * 2. Meta Webhook Incoming Message Handler (POST)
 */
type ExtractedInbound = {
  messageId: string;
  from: string;
  textBody?: string;
  buttonId?: string;
  image?: { id: string; mime_type?: string };
};

/**
 * Maps one Meta message object onto the internal inbound shape.
 * Returns null for unsupported message types or unusable payloads so they
 * are never fed into the registration state machine as empty text.
 */
export function extractInboundMessage(message: any): ExtractedInbound | null {
  if (!message || typeof message.id !== 'string' || !message.id || typeof message.from !== 'string' || !message.from) {
    return null;
  }
  const messageId = message.id;
  const from = message.from;

  let textBody: string | undefined;
  let buttonId: string | undefined;
  let image: { id: string; mime_type?: string } | undefined;

  if (message.type === 'text') {
    if (typeof message.text?.body === 'string' && message.text.body.length > 0) {
      textBody = message.text.body;
    }
  } else if (message.type === 'interactive') {
    if (message.interactive?.type === 'button_reply') {
      if (typeof message.interactive.button_reply?.id === 'string') buttonId = message.interactive.button_reply.id;
      if (typeof message.interactive.button_reply?.title === 'string') textBody = message.interactive.button_reply.title;
    } else if (message.interactive?.type === 'list_reply') {
      if (typeof message.interactive.list_reply?.id === 'string') buttonId = message.interactive.list_reply.id;
      if (typeof message.interactive.list_reply?.title === 'string') textBody = message.interactive.list_reply.title;
    }
  } else if (message.type === 'button') {
    if (typeof message.button?.payload === 'string') buttonId = message.button.payload;
    else if (typeof message.button?.text === 'string') buttonId = message.button.text;
    if (typeof message.button?.text === 'string') textBody = message.button.text;
  } else if (message.type === 'image') {
    const mediaId = message.image?.id;
    if (typeof mediaId === 'string' && mediaId.length > 0) {
      image = { id: mediaId };
      if (typeof message.image?.mime_type === 'string') image.mime_type = message.image.mime_type;
      if (typeof message.image?.caption === 'string' && message.image.caption.length > 0) {
        textBody = message.image.caption;
      }
    }
  } else {
    // Unsupported Meta message type (audio, video, sticker, document,
    // contacts, location, etc.): never synthesize empty text for it.
    return null;
  }

  if (!textBody && !buttonId && !image) return null;
  return { messageId, from, ...(textBody !== undefined ? { textBody } : {}), ...(buttonId !== undefined ? { buttonId } : {}), ...(image ? { image } : {}) };
}

whatsappRouter.post('/webhook', async (req: any, res) => {
  // Meta webhook requests are always authenticated. Simulator traffic uses its
  // separate route and invokes the workflow directly.
  const signature = req.headers['x-hub-signature-256'];
  const rawBody = req.rawBody as Buffer | undefined;

  if (!ConversationHandler.validateSignature(rawBody, signature)) {
    console.warn('[Meta Webhook] Invalid HMAC-SHA256 signature rejected.');
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }

  // Durable accept BEFORE acknowledgement: every supported inbound message
  // is persisted to the inbox first. Only then is HTTP 200 sent, so Meta
  // retries the batch later if persistence fails (HTTP 500). Processing
  // happens through the controlled inbox worker, which marks a message
  // PROCESSED only after successful handling and retries failures with
  // bounded attempts. Status-only events carry no inbound message and are
  // still acknowledged without inbox writes.
  try {
    // Runtime validation of the envelope after HMAC verification. Unknown
    // Meta fields are allowed; malformed bodies are logged, never thrown.
    const parsed = WhatsAppWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      // Malformed bodies can never become valid on retry, so acknowledge
      // explicitly instead of hanging the request or inviting indefinite
      // Meta redelivery. The validation failure is logged for diagnosis.
      console.warn('[Meta Webhook] Ignoring malformed webhook body:', parsed.error.issues);
      res.status(200).send('EVENT_RECEIVED');
      return;
    }

    const entries = parsed.data.entry ?? [];
    // Delivery-status updates are handled best-effort across every change;
    // they never enter the conversational state machine.
    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        const statuses = (change.value as any)?.statuses;
        if (Array.isArray(statuses) && statuses.length) {
          try {
            const { WhatsAppNotificationService } = await import('../services/whatsapp/whatsappNotifications.js');
            for (const s of statuses) {
              const mid = (s as any)?.id;
              const st = (s as any)?.status;
              if (typeof mid === 'string' && (st === 'sent' || st === 'delivered' || st === 'failed')) {
                WhatsAppNotificationService.markMetaStatus(mid, st === 'failed' ? 'failed' : st === 'sent' ? 'sent' : 'delivered', (s as any)?.errors?.[0]?.title);
              }
            }
          } catch { /* statuses are best-effort */ }
        }
      }
    }

    // Collect every inbound message in every change so a batched
    // delivery cannot drop messages past the first one.
    const pending: ExtractedInbound[] = [];
    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        const messages = (change.value as any)?.messages;
        if (!Array.isArray(messages)) continue;
        for (const message of messages) {
          const inbound = extractInboundMessage(message);
          if (!inbound) continue;
          pending.push(inbound);
        }
      }
    }

    // Persist before acknowledging. A throw here returns a retryable HTTP
    // 500 and Meta redelivers; duplicates collapse on UNIQUE(message_id).
    for (const inbound of pending) {
      enqueueInboundMessage(inbound);
    }
  } catch (err) {
    console.error('[Meta Webhook] Failed to persist inbound messages; returning retryable error.', err);
    res.status(500).json({ error: 'Failed to accept webhook payload' });
    return;
  }

  res.status(200).send('EVENT_RECEIVED');

  // Controlled worker drain. Shares the guarded cycle with the background
  // poller, so overlapping webhook deliveries never run concurrent loops.
  // Failures are retried with backoff and end in an observable FAILED row
  // instead of a silent permanent skip.
  try {
    await runInboxCycle();
  } catch (err) {
    console.error('[Meta Webhook] Inbox worker error:', err);
  }
});

/**
 * 2b. Manager notification outbox (errors visible to manager)
 */
whatsappRouter.get('/notifications', authMiddleware, requireManager, async (req, res, next) => {
  try {
    const { WhatsAppNotificationService } = await import('../services/whatsapp/whatsappNotifications.js');
    res.json({ notifications: WhatsAppNotificationService.getForManager(String(req.query.status || 'ALL')) });
  } catch (err) { next(err); }
});

/**
 * 2c. Inbox failures (manager-authorized operational view).
 * Terminal FAILED records stay terminal: this endpoint only inspects.
 * Message text/button payloads are excluded; managers see routing
 * metadata, attempts, timestamps and the bounded error only.
 */
whatsappRouter.get('/inbox/failures', authMiddleware, requireManager, (req, res, next) => {
  try {
    const limit = req.query.limit !== undefined ? parseInt(String(req.query.limit), 10) : 50;
    const offset = req.query.offset !== undefined ? parseInt(String(req.query.offset), 10) : 0;
    res.json(listInboxFailures(limit, offset));
  } catch (err) {
    next(err);
  }
});

/**
 * 3. WhatsApp Integration Status
 */
whatsappRouter.get('/status', (req, res) => {
  res.json({ status: WhatsAppService.getStatus() });
});

/**
 * The simulator is a local development and test aid, not a remotely
 * reachable API: without authentication any caller could impersonate an
 * arbitrary resident `from` number. The loopback gate below preserves local
 * development and automated testing while refusing remote use. Live mode
 * keeps the previous 404 behavior.
 */
export function isSimulatorRequestAllowed(req: any): boolean {
  if (WhatsAppService.getStatus().is_live) return false;
  // Automated tests drive the simulator over loopback HTTP.
  if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') return true;
  const ip = String(req.ip || req.socket?.remoteAddress || '');
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip.endsWith('127.0.0.1');
}

/**
 * 4. Simulator History
 */
whatsappRouter.get('/simulator/history', (req, res) => {
  if (WhatsAppService.getStatus().is_live) return res.status(404).json({ error: 'Local simulator is unavailable in live mode.' });
  if (!isSimulatorRequestAllowed(req)) return res.status(403).json({ error: 'Simulator is available on this host only.' });
  const phone = req.query.phone as string;
  const history = SimulatorProvider.getHistory(phone);
  res.json({ history });
});

/**
 * 5. Simulator Incoming Message Trigger
 */
whatsappRouter.post('/simulator/send', async (req, res, next) => {
  try {
    if (WhatsAppService.getStatus().is_live) { res.status(404).json({ error: 'Local simulator is unavailable in live mode.' }); return; }
    if (!isSimulatorRequestAllowed(req)) { res.status(403).json({ error: 'Simulator is available on this host only.' }); return; }
    const { from, textBody, buttonId } = req.body;
    if (!from) {
      res.status(400).json({ error: 'Phone number (from) is required' });
      return;
    }

    const messageId = `sim-in-${crypto.randomUUID()}`;
    await ConversationHandler.processIncomingMessage({
      messageId,
      from,
      textBody,
      buttonId
    });

    const recent = SimulatorProvider.getHistory(from);
    res.json({ success: true, messageId, recentReplies: recent.slice(0, 5) });
  } catch (err) {
    next(err);
  }
});

/**
 * 6. Clear Simulator History
 */
whatsappRouter.post('/simulator/clear', (req, res) => {
  if (WhatsAppService.getStatus().is_live) return res.status(404).json({ error: 'Local simulator is unavailable in live mode.' });
  if (!isSimulatorRequestAllowed(req)) return res.status(403).json({ error: 'Simulator is available on this host only.' });
  SimulatorProvider.clearHistory();
  res.json({ success: true });
});
