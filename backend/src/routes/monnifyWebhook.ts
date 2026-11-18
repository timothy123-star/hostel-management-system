import { Router } from 'express';
import { handleMonnifyWebhook } from '../services/monnify/monnifyPayments.js';

export const monnifyWebhookRouter = Router();

monnifyWebhookRouter.post('/', async (req: any, res, next) => {
  try {
    const raw: Buffer = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(JSON.stringify(req.body || {}), 'utf8');
    const signature = req.headers['monnify-signature'] as string | undefined;
    const remoteIp = (req.socket?.remoteAddress || '').toString();
    const result = await handleMonnifyWebhook({ rawBody: raw, signatureHeader: signature, remoteIp });
    res.json({ received: true, ...result });
  } catch (err: any) {
    if (err?.statusCode === 401) { res.status(401).json({ error: err.message }); return; }
    if (err?.statusCode === 400) { res.status(400).json({ error: err.message }); return; }
    if (err?.statusCode === 502) { res.status(502).json({ error: err.message }); return; }
    next(err);
  }
});
