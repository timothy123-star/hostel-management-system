import { Router } from 'express';
import crypto from 'crypto';
import { ConversationHandler } from '../services/whatsapp/conversationHandler.js';
import { WhatsAppService } from '../services/whatsapp/whatsappService.js';
import { SimulatorProvider } from '../services/whatsapp/simulatorProvider.js';
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
whatsappRouter.post('/webhook', async (req: any, res) => {
  // Validate signature if configured
  const signature = req.headers['x-hub-signature-256'] as string;
  const rawBody = req.rawBody || JSON.stringify(req.body);

  if (!ConversationHandler.validateSignature(rawBody, signature)) {
    console.warn('[Meta Webhook] Invalid HMAC-SHA256 signature rejected.');
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }

  // Fast 200 OK acknowledgement to Meta
  res.status(200).send('EVENT_RECEIVED');

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const message = change?.messages?.[0];

    if (!message) return;

    const from = message.from;
    const messageId = message.id;

    let textBody: string | undefined;
    let buttonId: string | undefined;

    if (message.type === 'text') {
      textBody = message.text?.body;
    } else if (message.type === 'interactive') {
      if (message.interactive?.type === 'button_reply') {
        buttonId = message.interactive.button_reply?.id;
        textBody = message.interactive.button_reply?.title;
      } else if (message.interactive?.type === 'list_reply') {
        buttonId = message.interactive.list_reply?.id;
        textBody = message.interactive.list_reply?.title;
      }
    } else if (message.type === 'button') {
      buttonId = message.button?.payload || message.button?.text;
      textBody = message.button?.text;
    }

    await ConversationHandler.processIncomingMessage({
      messageId,
      from,
      textBody,
      buttonId
    });
  } catch (err) {
    console.error('[Meta Webhook] Error processing message:', err);
  }
});

/**
 * 3. WhatsApp Integration Status
 */
whatsappRouter.get('/status', (req, res) => {
  res.json({ status: WhatsAppService.getStatus() });
});

/**
 * 4. Simulator History
 */
whatsappRouter.get('/simulator/history', (req, res) => {
  const phone = req.query.phone as string;
  const history = SimulatorProvider.getHistory(phone);
  res.json({ history });
});

/**
 * 5. Simulator Incoming Message Trigger
 */
whatsappRouter.post('/simulator/send', async (req, res, next) => {
  try {
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
  SimulatorProvider.clearHistory();
  res.json({ success: true });
});
