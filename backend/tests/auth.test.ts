import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { runSeed } from '../src/db/seed.js';

describe('Administrative API authentication', () => {
  beforeEach(async () => { await runSeed(true); });

  it('rejects unauthenticated administrative reads and accepts a valid manager session', async () => {
    const app = createApp();
    for (const path of ['/api/students', '/api/payments', '/api/bookings/groups', '/api/hostels', '/api/stats/overview', '/api/renewals', '/api/audit-logs']) {
      await request(app).get(path).expect(401);
    }
    const login = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'AdminPassword123!' }).expect(200);
    await request(app).get('/api/students').set('Authorization', `Bearer ${login.body.token}`).expect(200);
    await request(app).get('/api/auth/me').set('Authorization', 'Bearer invalid.token').expect(401);
  });
});
