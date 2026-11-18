import { Router } from 'express';
import { authMiddleware, requireManager, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { getAttempts, initiateAttempt, monnifyStatus, queryAndReconcile } from '../services/monnify/monnifyPayments.js';

export const monnifyRouter = Router();
monnifyRouter.use(authMiddleware, requireManager);

monnifyRouter.get('/status', (req, res, next) => {
  try { res.json({ monnify: monnifyStatus() }); } catch (err) { next(err); }
});

monnifyRouter.get('/attempts', (req, res, next) => {
  try { res.json({ attempts: getAttempts(req.query.paymentId as string | undefined) }); } catch (err) { next(err); }
});

monnifyRouter.post('/initiate', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { paymentId, bankCode } = req.body || {};
    if (!paymentId || typeof paymentId !== 'string') throw new Error('paymentId is required.');
    const attempt = await initiateAttempt({ paymentId, bankCode, adminId: req.admin?.id });
    res.json({ attempt });
  } catch (err) { next(err); }
});

monnifyRouter.post('/reconcile', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { merchantReference, transactionReference } = req.body || {};
    if (!merchantReference && !transactionReference) throw new Error('merchantReference or transactionReference is required.');
    const attempt = await queryAndReconcile({ merchantReference, transactionReference, adminId: req.admin?.id });
    res.json({ attempt });
  } catch (err) { next(err); }
});
