import { Router } from 'express';
import { QRService } from '../services/qrService.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { VerifyQRTokenSchema, RevokeQRSchema } from '@hostel/shared';
import { z } from 'zod';

export const qrRouter = Router();

// These routes deliberately precede authenticated manager routes. The token is
// the opaque bearer credential; no identity data is returned for an invalid pass.
qrRouter.get('/public/:token', (req, res, next) => {
  try { res.set('Cache-Control', 'no-store'); res.json(QRService.getPublicVerification(req.params.token)); } catch (err) { next(err); }
});

qrRouter.get('/public/:token/photo', (req, res, next) => {
  try {
    const photo = QRService.getVerifiedPhoto(req.params.token);
    res.set({ 'Content-Type': photo.mimeType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.sendFile(photo.storagePath);
  } catch (err) { next(err); }
});

qrRouter.post('/verify', authMiddleware, (req: AuthenticatedRequest, res, next) => {
  try {
    const input = VerifyQRTokenSchema.parse(req.body);
    const result = QRService.verifyToken(input.token, 'MANAGER', input.method, req.admin?.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

const IssueCredentialSchema = z.object({ reissue: z.boolean().default(false) });
qrRouter.post('/credentials/:studentId/issue', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = IssueCredentialSchema.parse(req.body);
    const result = QRService.issueCredential(req.params.studentId, req.admin!.id, input.reissue);
    // Return the rendered QR once; neither the raw token nor its URL is sent
    // through general manager API payloads or persisted client state.
    res.status(201).json({ credential: result.credential, allocation: result.allocation, qrImageData: await QRService.generateQRImage(result.token) });
  } catch (err) { next(err); }
});

qrRouter.post('/:id/revoke', authMiddleware, (req: AuthenticatedRequest, res, next) => {
  try {
    const input = RevokeQRSchema.parse(req.body);
    const success = QRService.revokeCredential(req.params.id, input.reason, req.admin!.id);
    if (!success) {
      res.status(404).json({ error: 'QR credential not found' });
      return;
    }
    res.json({ success: true, message: 'QR identity pass successfully revoked.' });
  } catch (err) {
    next(err);
  }
});

qrRouter.get('/credentials', authMiddleware, (req, res, next) => {
  try {
    res.json({ credentials: QRService.getCredentials() });
  } catch (err) {
    next(err);
  }
});

qrRouter.get('/access-logs', authMiddleware, (req, res, next) => {
  try {
    res.json({ accessLogs: QRService.getAccessLogs() });
  } catch (err) {
    next(err);
  }
});
