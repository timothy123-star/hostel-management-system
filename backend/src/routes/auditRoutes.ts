import { Router } from 'express';
import { AuditService } from '../services/auditService.js';
import { authMiddleware, requireManager } from '../middleware/authMiddleware.js';

export const auditRouter = Router();

auditRouter.get('/', authMiddleware, requireManager, (req, res, next) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    const logs = AuditService.getLogs(limit);
    res.json({ logs });
  } catch (err) {
    next(err);
  }
});
