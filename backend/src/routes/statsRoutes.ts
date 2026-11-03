import { Router } from 'express';
import { StatsService } from '../services/statsService.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

export const statsRouter = Router();

statsRouter.get('/overview', (req, res, next) => {
  try {
    const stats = StatsService.getDashboardStats();
    res.json({ stats });
  } catch (err) {
    next(err);
  }
});

statsRouter.get('/export/:type', authMiddleware, (req, res, next) => {
  try {
    const type = req.params.type as any;
    const csv = StatsService.generateCSV(type);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${type}_report_${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});
