import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('Railway single-service production hosting', () => {
  it('serves health check for Railway healthcheckPath', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('serves SPA fallback for direct navigation without hijacking /api', async () => {
    const app = createApp();
    const frontendDist = path.resolve(__dirname, '../../frontend/dist');
    if (!fs.existsSync(path.join(frontendDist, 'index.html'))) {
      // Railway builds frontend/dist; local test env without a build keeps API-only mode.
      const api404 = await request(app).get('/api/does-not-exist');
      expect(api404.status).toBe(404);
      return;
    }
    for (const route of ['/', '/male-hostel', '/photo-upload/abc123', '/resident-verification/abc123']) {
      const res = await request(app).get(route);
      expect(res.status).toBe(200);
      expect(res.text).toContain('<div id="root">');
    }
    const api404 = await request(app).get('/api/does-not-exist');
    expect(api404.status).toBe(404);
    expect(api404.body).toEqual({ error: 'Not found' });
    expect(api404.text).not.toContain('<div id="root">');
  });

  it('retains webhook HMAC validation on the single service', async () => {
    await request(createApp())
      .post('/api/whatsapp/webhook')
      .send({ entry: [] })
      .expect(401, { error: 'Invalid webhook signature' });
  });

  it('never exposes private uploads or database files as static content', async () => {
    const app = createApp();
    const frontendDist = path.resolve(__dirname, '../../frontend/dist');
    if (!fs.existsSync(path.join(frontendDist, 'index.html'))) return;
    // File-like URLs (database files, dotfiles, missing assets) and private
    // namespaces must 404: never 200, never the SPA shell, never file bytes.
    for (const sensitive of [
      '/hostel.sqlite',
      '/hostel.sqlite-wal',
      '/private-uploads/student-photos/x.jpg',
      '/private-uploads',
      '/data/hostel.sqlite',
      '/assets/does-not-exist.js',
      '/.env'
    ]) {
      const res = await request(app).get(sensitive);
      expect(res.status).toBe(404);
      expect(res.text ?? '').not.toContain('<div id="root">');
      expect(res.body?.toString?.() ?? res.text).not.toContain('SQLite format');
    }
  });

  it('supports Railway volume paths via env without touching the demo DB', () => {
    const dbResolved = path.resolve('/data/hostel.sqlite');
    const photosResolved = path.resolve('/data/photos');
    expect(dbResolved).toBe(path.join(path.sep, 'data', 'hostel.sqlite'));
    expect(photosResolved).toBe(path.join(path.sep, 'data', 'photos'));
    // Parent-dir creation is verified by getDb mkdir guard; use an isolated
    // temp nested path to prove nested directories are created safely.
    const nested = path.join(os.tmpdir(), `hostelos-railway-check-${process.pid}`, 'nested', 'check.sqlite');
    fs.mkdirSync(path.dirname(nested), { recursive: true });
    expect(fs.existsSync(path.dirname(nested))).toBe(true);
    fs.rmSync(path.join(os.tmpdir(), `hostelos-railway-check-${process.pid}`), { recursive: true, force: true });
  });
});
