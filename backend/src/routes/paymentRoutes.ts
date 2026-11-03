import { Router } from 'express';
import { PaymentService } from '../services/paymentService.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { VerifyPaymentSchema, RejectPaymentSchema } from '@hostel/shared';

export const paymentRouter = Router();

paymentRouter.get('/', (req, res, next) => {
  try {
    const { status, hostel } = req.query as any;
    const payments = PaymentService.getPayments(status, hostel);
    res.json({ payments });
  } catch (err) {
    next(err);
  }
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
