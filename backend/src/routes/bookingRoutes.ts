import { Router } from 'express';
import { BookingGroupService } from '../services/bookingGroupService.js';
import { MatchingService } from '../services/matchingService.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware.js';

export const bookingRouter = Router();
bookingRouter.use(authMiddleware);

bookingRouter.get('/groups', (req, res, next) => {
  try {
    const { hostel, status } = req.query as any;
    const groups = BookingGroupService.getGroups(hostel, status);
    res.json({ groups });
  } catch (err) {
    next(err);
  }
});

bookingRouter.get('/groups/:id', (req, res, next) => {
  try {
    const group = BookingGroupService.getGroupById(req.params.id);
    if (!group) {
      res.status(404).json({ error: 'Booking group not found' });
      return;
    }
    res.json({ group });
  } catch (err) {
    next(err);
  }
});

bookingRouter.get('/matching-queue', (req, res, next) => {
  try {
    const { hostel, status, capacity } = req.query as any;
    const parsedCapacity = capacity ? Number(capacity) : undefined;
    if (parsedCapacity !== undefined && ![1, 2, 3].includes(parsedCapacity)) throw new Error('Capacity must be 1, 2, or 3.');
    const queue = MatchingService.getQueueItems(hostel, status, parsedCapacity as 1 | 2 | 3 | undefined);
    res.json({ queue });
  } catch (err) {
    next(err);
  }
});

bookingRouter.post('/matching/run', authMiddleware, (req: AuthenticatedRequest, res, next) => {
  try { res.json(MatchingService.runMatching(req.body.hostel, req.body.capacity)); }
  catch (err) { next(err); }
});

bookingRouter.post('/groups/:id/complete-from-queue', authMiddleware, (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.body.queue_item_id) throw new Error('A queue candidate is required.');
    MatchingService.completeKnownTripleGroup(req.params.id, req.body.queue_item_id);
    res.json({ group: BookingGroupService.getGroupById(req.params.id) });
  } catch (err) { next(err); }
});
