import { Router } from 'express';
import { AnnouncementService } from '../services/announcementService.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { ComposeAnnouncementSchema } from '@hostel/shared';

export const announcementRouter = Router();
announcementRouter.use(authMiddleware);

announcementRouter.get('/', (req, res, next) => {
  try {
    const announcements = AnnouncementService.getAnnouncements();
    res.json({ announcements });
  } catch (err) {
    next(err);
  }
});

announcementRouter.get('/:id', (req, res, next) => {
  try {
    const announcement = AnnouncementService.getAnnouncementById(req.params.id);
    if (!announcement) {
      res.status(404).json({ error: 'Announcement not found' });
      return;
    }
    res.json({ announcement });
  } catch (err) {
    next(err);
  }
});

announcementRouter.post('/preview', authMiddleware, (req, res, next) => {
  try {
    const input = ComposeAnnouncementSchema.parse(req.body);
    const preview = AnnouncementService.previewAnnouncement(input);
    res.json(preview);
  } catch (err) {
    next(err);
  }
});

announcementRouter.post('/send', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = ComposeAnnouncementSchema.parse(req.body);
    const announcement = await AnnouncementService.sendAnnouncement(input, req.admin?.id);
    res.status(201).json({ announcement });
  } catch (err) {
    next(err);
  }
});
