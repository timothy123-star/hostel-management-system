import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/authRoutes.js';
import { hostelRouter } from './routes/hostelRoutes.js';
import { studentRouter } from './routes/studentRoutes.js';
import { bookingRouter } from './routes/bookingRoutes.js';
import { paymentRouter } from './routes/paymentRoutes.js';
import { allocationRouter } from './routes/allocationRoutes.js';
import { qrRouter } from './routes/qrRoutes.js';
import { renewalRouter } from './routes/renewalRoutes.js';
import { announcementRouter } from './routes/announcementRoutes.js';
import { statsRouter } from './routes/statsRoutes.js';
import { auditRouter } from './routes/auditRoutes.js';
import { whatsappRouter } from './routes/whatsappRoutes.js';
import { studentPhotoRouter } from './routes/studentPhotoRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();

  app.use(cors());

  // Capture raw body for webhook HMAC validation
  app.use(express.json({
    verify: (req: any, res, buf) => {
      req.rawBody = buf;
    }
  }));

  app.use(express.urlencoded({ extended: true }));

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'hostel-management-backend', timestamp: new Date().toISOString() });
  });

  // Mount API modules
  app.use('/api/auth', authRouter);
  app.use('/api/hostels', hostelRouter);
  app.use('/api/students', studentRouter);
  app.use('/api/bookings', bookingRouter);
  app.use('/api/payments', paymentRouter);
  app.use('/api/allocations', allocationRouter);
  app.use('/api/qr', qrRouter);
  app.use('/api/renewals', renewalRouter);
  app.use('/api/announcements', announcementRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api/reports', statsRouter);
  app.use('/api/audit-logs', auditRouter);
  app.use('/api/whatsapp', whatsappRouter);
  app.use('/api', studentPhotoRouter);

  // Centralized error handler
  app.use(errorHandler);

  return app;
}
