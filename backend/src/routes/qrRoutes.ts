import { Router } from 'express';
import { QRService } from '../services/qrService.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { VerifyQRTokenSchema, RevokeQRSchema } from '@hostel/shared';
import { getDb } from '../db/connection.js';

export const qrRouter = Router();

qrRouter.post('/verify', authMiddleware, (req: AuthenticatedRequest, res, next) => {
  try {
    const input = VerifyQRTokenSchema.parse(req.body);
    const result = QRService.verifyToken(input.token, req.admin?.id, input.method);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

qrRouter.post('/:id/revoke', authMiddleware, (req: AuthenticatedRequest, res, next) => {
  try {
    const input = RevokeQRSchema.parse(req.body);
    const success = QRService.revokeCredential(req.params.id, input.reason);
    if (!success) {
      res.status(404).json({ error: 'QR credential not found' });
      return;
    }
    res.json({ success: true, message: 'QR identity pass successfully revoked.' });
  } catch (err) {
    next(err);
  }
});

qrRouter.post('/:id/reactivate', authMiddleware, (req: AuthenticatedRequest, res, next) => {
  try {
    const success = QRService.reactivateCredential(req.params.id);
    if (!success) {
      res.status(404).json({ error: 'QR credential not found' });
      return;
    }
    res.json({ success: true, message: 'QR identity pass successfully reactivated.' });
  } catch (err) {
    next(err);
  }
});

qrRouter.get('/credentials', authMiddleware, (req, res, next) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT q.*, s.full_name as student_name, s.phone_number, s.gender,
             r.room_number, h.code as hostel_code, h.name as hostel_name
      FROM qr_credentials q
      JOIN students s ON q.student_id = s.id
      JOIN room_allocations ra ON q.room_allocation_id = ra.id
      JOIN rooms r ON ra.room_id = r.id
      JOIN hostels h ON r.hostel_id = h.id
      ORDER BY q.created_at DESC
    `).all();
    res.json({ credentials: rows });
  } catch (err) {
    next(err);
  }
});

qrRouter.get('/access-logs', authMiddleware, (req, res, next) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT al.*, 
             s.full_name as student_name, s.phone_number as student_phone,
             au.username as verified_by_username
      FROM access_logs al
      LEFT JOIN students s ON al.student_id = s.id
      LEFT JOIN admin_users au ON al.verified_by_admin_id = au.id
      ORDER BY al.logged_at DESC
      LIMIT 100
    `).all();
    res.json({ accessLogs: rows });
  } catch (err) {
    next(err);
  }
});
