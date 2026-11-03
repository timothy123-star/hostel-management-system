import { Router } from 'express';
import { RenewalService } from '../services/renewalService.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { SendRenewalReminderSchema } from '@hostel/shared';

export const renewalRouter = Router();

renewalRouter.get('/', (req, res, next) => {
  try {
    const urgency = req.query.urgency as string;
    const renewals = RenewalService.getUpcomingRenewals(urgency);
    res.json({ renewals });
  } catch (err) {
    next(err);
  }
});

renewalRouter.post('/send-reminders', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = SendRenewalReminderSchema.parse(req.body);
    const result = await RenewalService.sendRenewalReminders({
      studentIds: input.student_ids,
      reminderType: input.reminder_type,
      adminId: req.admin?.id
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
