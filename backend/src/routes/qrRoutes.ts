import { Router } from 'express';
import { QRService } from '../services/qrService.js';
import { authMiddleware, requireManager, requireScanRole, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { VerifyQRTokenSchema, RevokeQRSchema } from '@hostel/shared';
import { z } from 'zod';

export const qrRouter = Router();

function publicSecurityHeaders(res: any) {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
}

// Lightweight in-memory rate limiter for staff verification reads (avoids new deps).
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function staffRateLimit(req: any, res: any, next: any) {
  const ip = String(req.ip || req.headers['x-forwarded-for'] || 'unknown');
  const now = Date.now();
  const entry = rateBuckets.get(ip);
  if (!entry || now > entry.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return next();
  }
  entry.count += 1;
  if (entry.count > 60) {
    res.status(429).json({ status: 'INVALID_CREDENTIAL', reason: 'Too many attempts. Try again shortly.' });
    return;
  }
  next();
}

// Authorized gate-scan endpoints. Both MANAGER and SECURITY roles may verify
// residents here; possession of the QR credential alone never returns
// resident information. The QR code itself carries only the opaque
// credential; the photograph is served through the authenticated photo
// endpoint below, never embedded in the code or exposed anonymously.
qrRouter.get('/staff/:token', authMiddleware, requireScanRole, staffRateLimit, (req: AuthenticatedRequest, res, next) => {
  try { publicSecurityHeaders(res); res.json(QRService.getPublicVerification(req.params.token, 'MANAGER', req.admin?.id, req.admin?.role)); } catch (err) { next(err); }
});

qrRouter.get('/staff/:token/photo', authMiddleware, requireScanRole, staffRateLimit, (req: AuthenticatedRequest, res, next) => {
  try {
    const photo = QRService.getVerifiedPhoto(req.params.token, 'MANAGER', req.admin?.id, req.admin?.role);
    res.set({ 'Content-Type': photo.mimeType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    res.sendFile(photo.storagePath);
  } catch (err) { next(err); }
});

qrRouter.post('/verify', authMiddleware, requireScanRole, (req: AuthenticatedRequest, res, next) => {
  try {
    const input = VerifyQRTokenSchema.parse(req.body);
    const result = QRService.verifyToken(input.token, 'MANAGER', input.method, req.admin?.id, req.admin?.role);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

const IssueCredentialSchema = z.object({ reissue: z.boolean().default(false) });
qrRouter.post('/credentials/:studentId/issue', authMiddleware, requireManager, async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = IssueCredentialSchema.parse(req.body);
    const result = QRService.issueCredential(req.params.studentId, req.admin!.id, input.reissue);
    // Return the rendered QR once; neither the raw token nor its URL is sent
    // through general manager API payloads or persisted client state.
    res.status(201).json({ credential: result.credential, allocation: result.allocation, qrImageData: await QRService.generateQRImage(result.token) });
  } catch (err) { next(err); }
});

qrRouter.post('/:id/revoke', authMiddleware, requireManager, (req: AuthenticatedRequest, res, next) => {
  try {
    const input = RevokeQRSchema.parse(req.body);
    const success = QRService.revokeCredential(req.params.id, input.reason, req.admin!.id);
    if (!success) {
      res.status(404).json({ error: 'QR credential not found' });
      return;
    }
    res.json({ success: true, message: 'QR identity pass successfully revoked.' });
  } catch (err) { next(err); }
});

qrRouter.get('/credentials', authMiddleware, requireManager, (req, res, next) => {
  try {
    res.json({ credentials: QRService.getCredentials() });
  } catch (err) { next(err); }
});

qrRouter.get('/access-logs', authMiddleware, requireManager, (req, res, next) => {
  try {
    res.json({ accessLogs: QRService.getAccessLogs() });
  } catch (err) { next(err); }
});

// Manager-only scan audit: recent scans plus suspicious-reuse flags.
qrRouter.get('/scan-audit', authMiddleware, requireManager, (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    res.json(QRService.getScanAudit(limit));
  } catch (err) { next(err); }
});
