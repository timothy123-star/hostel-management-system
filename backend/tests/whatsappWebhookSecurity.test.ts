import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { ConversationHandler } from '../src/services/whatsapp/conversationHandler.js';
import { whatsappRouter } from '../src/routes/whatsappRoutes.js';

const webhookPath = '/api/whatsapp/webhook';
const body = { entry: [{ changes: [{ value: { messages: [{ id: 'wamid.test', from: '15550000000', type: 'text', text: { body: 'MENU' } }] } }] }] };
const originalSecret = config.meta.appSecret;

function signatureFor(payload: unknown, secret = config.meta.appSecret): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex')}`;
}

describe('Meta webhook signature security', () => {
  afterEach(() => {
    config.meta.appSecret = originalSecret;
    vi.restoreAllMocks();
  });

  it.each([
    ['missing App Secret', undefined, 'sha256=' + 'a'.repeat(64)],
    ['empty App Secret', '', 'sha256=' + 'a'.repeat(64)],
    ['missing signature header', 'test-app-secret', undefined],
    ['malformed signature', 'test-app-secret', 'not-a-meta-signature'],
    ['invalid signature', 'test-app-secret', 'sha256=' + 'a'.repeat(64)]
  ])('rejects %s without invoking the workflow', async (_case, appSecret, signature) => {
    config.meta.appSecret = appSecret as string;
    const process = vi.spyOn(ConversationHandler, 'processIncomingMessage').mockResolvedValue(undefined);
    let call = request(createApp()).post(webhookPath).send(body);
    if (signature) call = call.set('X-Hub-Signature-256', signature);

    await call.expect(401, { error: 'Invalid webhook signature' });
    expect(process).not.toHaveBeenCalled();
  });

  it('rejects a missing raw request body without invoking the workflow', async () => {
    config.meta.appSecret = 'test-app-secret';
    const process = vi.spyOn(ConversationHandler, 'processIncomingMessage').mockResolvedValue(undefined);
    const appWithoutRawCapture = express();
    appWithoutRawCapture.use(express.json());
    appWithoutRawCapture.use('/api/whatsapp', whatsappRouter);

    await request(appWithoutRawCapture).post(webhookPath).set('X-Hub-Signature-256', signatureFor(body)).send(body)
      .expect(401, { error: 'Invalid webhook signature' });
    expect(process).not.toHaveBeenCalled();
  });

  it('rejects repeated signature-header values without throwing', () => {
    config.meta.appSecret = 'test-app-secret';
    expect(ConversationHandler.validateSignature(Buffer.from(JSON.stringify(body)), ['sha256=' + 'a'.repeat(64)])).toBe(false);
  });

  it('accepts only a valid signature for the exact raw JSON body', async () => {
    config.meta.appSecret = 'test-app-secret';
    const process = vi.spyOn(ConversationHandler, 'processIncomingMessage').mockResolvedValue(undefined);

    await request(createApp()).post(webhookPath).set('X-Hub-Signature-256', signatureFor(body)).send(body)
      .expect(200, 'EVENT_RECEIVED');
    expect(process).toHaveBeenCalledWith({ messageId: 'wamid.test', from: '15550000000', textBody: 'MENU', buttonId: undefined });
  });
});
