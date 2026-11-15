import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  // Single-service production hosting: serve the compiled Vite frontend when
  // present (Railway builds `frontend/dist` via `npm run build`). Only this
  // directory is exposed. Private uploads and SQLite files are never mounted
  // here.
  // Unknown API paths always receive a JSON 404, never frontend HTML.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  const frontendDist = path.resolve(__dirname, '../../frontend/dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    // SPA fallback for direct navigation/refresh. Plain middleware (no '*'
    // route pattern) is valid on both Express 4 and Express 5
    // (path-to-regexp v8 rejects '*' in Express 5). Serves index.html only
    // for extensionless SPA routes such as /female-hostel and
    // /resident-verification/:token.
    // Only files under frontend/dist are ever served here; private uploads,
    // SQLite files and /data stay unreachable.
    app.use((req, res, next) => {
      if (req.path.startsWith('/api')) {
        return next();
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return next();
      }
      // Private namespaces must never resolve to the SPA shell, even when
      // the path has no file extension.
      if (
        req.path === '/private-uploads' ||
        req.path.startsWith('/private-uploads/') ||
        req.path === '/data' ||
        req.path.startsWith('/data/')
      ) {
        return next();
      }
      // Unknown file-like paths (missing assets, dotfiles, database files
      // such as /hostel.sqlite) are 404s, not SPA routes: every valid SPA
      // route in this app is extensionless.
      const base = req.path.slice(req.path.lastIndexOf('/') + 1);
      if (base.includes('.')) {
        return next();
      }
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  // Centralized error handler
  app.use(errorHandler);

  return app;
}
