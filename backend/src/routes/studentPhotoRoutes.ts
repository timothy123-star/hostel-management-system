import express, { Router } from 'express';
import { authMiddleware, requireManager, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { StudentPhotoService } from '../services/studentPhotoService.js';
import { PhotoDisplayConsentService } from '../services/photoDisplayConsentService.js';
import { WhatsAppService } from '../services/whatsapp/whatsappService.js';

export const studentPhotoRouter = Router();

studentPhotoRouter.get('/photo-reviews', authMiddleware, requireManager, (req, res, next) => {
  try { res.json({ reviews: StudentPhotoService.getReviewQueue(String(req.query.status || 'PENDING_REVIEW')) }); } catch (err) { next(err); }
});

studentPhotoRouter.get('/photo-reviews/:studentId/image', authMiddleware, requireManager, (req, res, next) => {
  try {
    const submissionId = typeof req.query.submission_id === 'string' ? req.query.submission_id : undefined;
    const photo = StudentPhotoService.getPhotoForManager(req.params.studentId, submissionId);
    res.set({ 'Content-Type': photo.mimeType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.sendFile(photo.storagePath);
  } catch (err) { next(err); }
});

studentPhotoRouter.get('/photo-reviews/:studentId/history', authMiddleware, requireManager, (req, res, next) => {
  try { res.json({ history: StudentPhotoService.getReviewHistory(req.params.studentId) }); } catch (err) { next(err); }
});

studentPhotoRouter.post('/photo-reviews/:studentId/approve', authMiddleware, requireManager, (req: AuthenticatedRequest, res, next) => {
  try { res.json({ review: StudentPhotoService.reviewPhoto(req.params.studentId, 'APPROVED', req.admin!.id, undefined, req.body?.submission_id) }); } catch (err) { next(err); }
});

studentPhotoRouter.post('/photo-reviews/:studentId/reject', authMiddleware, requireManager, (req: AuthenticatedRequest, res, next) => {
  try { res.json({ review: StudentPhotoService.reviewPhoto(req.params.studentId, 'REJECTED', req.admin!.id, req.body?.reason, req.body?.submission_id) }); } catch (err) { next(err); }
});

studentPhotoRouter.post('/photo-reviews/:studentId/request-replacement', authMiddleware, requireManager, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (WhatsAppService.getStatus().is_live) throw new Error('Replacement upload delivery is available only through the local WhatsApp simulator in this milestone.');
    const result = StudentPhotoService.authorizeReplacement(req.params.studentId, req.admin!.id);
    await WhatsAppService.getProvider().sendTextMessage(result.phoneNumber, `HostelOS replacement photo upload link (expires in 60 minutes): ${result.uploadUrl}\nBy uploading you agree the photo will be reviewed by management and, once approved, shown with your name, facility and room on authorized QR scans.`);
    res.status(201).json({ upload_url: result.uploadUrl, expires_at: result.expiresAt, delivery: 'SIMULATED' });
  } catch (err) { next(err); }
});

studentPhotoRouter.post('/students/:id/photo-upload-link', authMiddleware, requireManager, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (WhatsAppService.getStatus().is_live) throw new Error('Photo-upload link delivery is available only through the local WhatsApp simulator in this milestone.');
    const result = StudentPhotoService.issueUploadLink(req.params.id, req.admin!.id);
    await WhatsAppService.getProvider().sendTextMessage(result.phoneNumber, `HostelOS photo upload link (expires in 60 minutes): ${result.uploadUrl}\nBy uploading you agree the photo will be reviewed by management and, once approved, shown with your name, facility and room on authorized QR scans.`);
    res.status(201).json({ upload_url: result.uploadUrl, expires_at: result.expiresAt, delivery: 'SIMULATED' });
  } catch (err) { next(err); }
});

studentPhotoRouter.get('/photo-display-consent/:studentId', authMiddleware, requireManager, (req, res, next) => {
  try {
    res.json({ consent: PhotoDisplayConsentService.getCurrentStatus(req.params.studentId), history: PhotoDisplayConsentService.getHistory(req.params.studentId) });
  } catch (err) { next(err); }
});

studentPhotoRouter.post('/photo-display-consent/:studentId/withdraw', authMiddleware, requireManager, (req: AuthenticatedRequest, res, next) => {
  try {
    res.json({ consent: PhotoDisplayConsentService.recordDecision({ studentId: req.params.studentId, decision: 'WITHDRAWN', decidedBy: 'MANAGER', adminId: req.admin!.id, notes: req.body?.reason || req.body?.notes }) });
  } catch (err) { next(err); }
});

studentPhotoRouter.get('/student-photo-upload/:token', (req, res, next) => {
  try { res.json(StudentPhotoService.validateLink(req.params.token)); } catch (err) { next(err); }
});

studentPhotoRouter.post('/student-photo-upload/:token', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }), (req, res, next) => {
  try { res.status(201).json(StudentPhotoService.submitPhoto(req.params.token, req.body)); } catch (err) { next(err); }
});
