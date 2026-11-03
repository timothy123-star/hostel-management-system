import { Router } from 'express';
import { PaymentService } from '../services/paymentService.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { VerifyPaymentSchema, RejectPaymentSchema } from '@hostel/shared';

export const paymentRouter = Router();
paymentRouter.use(authMiddleware);

paymentRouter.get('/', (req, res, next) => {
  try {
    const { status, hostel } = req.query as any;
    const payments = PaymentService.getPayments(status, hostel);
    res.json({ payments });
  } catch (err) {
    next(err);
  }
});

paymentRouter.get('/demo-transactions', (req, res, next) => {
  try { res.json({ transactions: PaymentService.getDemoTransactions(req.query.status as string) }); }
  catch (err) { next(err); }
});

paymentRouter.post('/demo-transactions/:id/reconcile', (req: AuthenticatedRequest, res, next) => {
  try { res.json({ payment: PaymentService.reconcileDemoTransaction(req.params.id, req.admin?.id) }); }
  catch (err) { next(err); }
});

paymentRouter.post('/demo-transactions/:id/reject', (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.body.reason || String(req.body.reason).trim().length < 3) throw new Error('A rejection reason is required.');
    PaymentService.rejectDemoTransaction(req.params.id, String(req.body.reason).trim(), req.admin?.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

paymentRouter.post('/:id/verify', authMiddleware, (req: AuthenticatedRequest, res, next) => {
  try {
    const input = VerifyPaymentSchema.parse(req.body);
    const payment = PaymentService.verifyPayment(req.params.id, req.admin?.id, input.notes);
    res.json({ payment });
  } catch (err) {
    next(err);
  }
});

paymentRouter.post('/:id/reject', authMiddleware, (req: AuthenticatedRequest, res, next) => {
  try {
    const input = RejectPaymentSchema.parse(req.body);
    const payment = PaymentService.rejectPayment(req.params.id, input.reason, req.admin?.id);
    res.json({ payment });
  } catch (err) {
    next(err);
  }
});
