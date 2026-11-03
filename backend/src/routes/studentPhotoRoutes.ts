import express, { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { StudentPhotoService } from '../services/studentPhotoService.js';
import { WhatsAppService } from '../services/whatsapp/whatsappService.js';

export const studentPhotoRouter = Router();

studentPhotoRouter.post('/students/:id/photo-upload-link', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (WhatsAppService.getStatus().is_live) throw new Error('Photo-upload link delivery is available only through the local WhatsApp simulator in this milestone.');
    const result = StudentPhotoService.issueUploadLink(req.params.id, req.admin!.id);
    await WhatsAppService.getProvider().sendTextMessage(result.phoneNumber, `HostelOS photo upload link (expires in 60 minutes): ${result.uploadUrl}`);
    res.status(201).json({ upload_url: result.uploadUrl, expires_at: result.expiresAt, delivery: 'SIMULATED' });
  } catch (err) { next(err); }
});

studentPhotoRouter.get('/student-photo-upload/:token', (req, res, next) => {
  try { res.json(StudentPhotoService.validateLink(req.params.token)); } catch (err) { next(err); }
});

studentPhotoRouter.post('/student-photo-upload/:token', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }), (req, res, next) => {
  try { res.status(201).json(StudentPhotoService.submitPhoto(req.params.token, req.body)); } catch (err) { next(err); }
});
