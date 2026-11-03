import { Router } from 'express';
import { BookingGroupService } from '../services/bookingGroupService.js';
import { MatchingService } from '../services/matchingService.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware.js';

export const bookingRouter = Router();

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
    const { hostel } = req.query as any;
    const queue = MatchingService.getQueueItems(hostel);
    res.json({ queue });
  } catch (err) {
    next(err);
  }
});
