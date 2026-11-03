import fs from 'fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { runSeed } from '../src/db/seed.js';
import { config } from '../src/config.js';
import { createApp } from '../src/app.js';
import { StudentPhotoService } from '../src/services/studentPhotoService.js';
import { getDb } from '../src/db/connection.js';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0x01, 0x11, 0x00, 0xff, 0xd9]);

describe('Manager photograph review and approval', () => {
  beforeEach(async () => { await runSeed(true); fs.rmSync(config.photoStorageDir, { recursive: true, force: true }); });
  afterEach(() => fs.rmSync(config.photoStorageDir, { recursive: true, force: true }));

  async function managerToken() {
    const login = await request(createApp()).post('/api/auth/login').send({ username: 'admin', password: 'AdminPassword123!' });
    return login.body.token as string;
  }
  function submit() {
    const token = StudentPhotoService.issueUploadLink('stu-demo-01', 'admin-root-01').uploadUrl.split('/').pop()!;
    StudentPhotoService.submitPhoto(token, jpeg);
  }

  it('lists pending reviews and restricts private preview to authenticated managers', async () => {
    submit();
    const app = createApp(); const token = await managerToken();
    const queue = await request(app).get('/api/photo-reviews?status=PENDING_REVIEW').set('Authorization', `Bearer ${token}`).expect(200);
    expect(queue.body.reviews).toHaveLength(1);
    expect(queue.body.reviews[0]).toMatchObject({ student_id: 'stu-demo-01', photo_status: 'PENDING_REVIEW', room_number: 'M-101' });
    await request(app).get('/api/photo-reviews/stu-demo-01/image').expect(401);
    const image = await request(app).get('/api/photo-reviews/stu-demo-01/image').set('Authorization', `Bearer ${token}`).expect(200);
    expect(image.headers['content-type']).toContain('image/jpeg');
    expect(image.headers['cache-control']).toContain('no-store');
    await request(app).get('/api/photo-reviews/not-a-student/image').set('Authorization', `Bearer ${token}`).expect(400);
  });

  it('approves only a pending photograph and writes manager review history', async () => {
    submit();
    const app = createApp(); const token = await managerToken();
    await request(app).post('/api/photo-reviews/stu-demo-01/approve').set('Authorization', `Bearer ${token}`).expect(200);
    expect((getDb().prepare("SELECT status FROM student_photo_submissions WHERE student_id = ? ORDER BY submitted_at DESC LIMIT 1").get('stu-demo-01') as any).status).toBe('APPROVED');
    await request(app).post('/api/photo-reviews/stu-demo-01/approve').set('Authorization', `Bearer ${token}`).expect(400);
    const history = await request(app).get('/api/photo-reviews/stu-demo-01/history').set('Authorization', `Bearer ${token}`).expect(200);
    expect(history.body.history).toHaveLength(1);
    expect(history.body.history[0]).toMatchObject({ status: 'APPROVED', reviewer_name: 'Hostel General Manager' });
    expect(getDb().prepare("SELECT action FROM audit_logs WHERE entity_id = ? AND action = 'APPROVE_STUDENT_PHOTO'").get('stu-demo-01')).toBeTruthy();
  });

  it('requires a rejection reason and authorizes a replacement without losing history or token protections', async () => {
    submit();
    const app = createApp(); const token = await managerToken();
    await request(app).post('/api/photo-reviews/stu-demo-01/reject').set('Authorization', `Bearer ${token}`).send({ reason: '   ' }).expect(400);
    await request(app).post('/api/photo-reviews/stu-demo-01/reject').set('Authorization', `Bearer ${token}`).send({ reason: 'Face is not clearly visible.' }).expect(200);
    const replacement = await request(app).post('/api/photo-reviews/stu-demo-01/request-replacement').set('Authorization', `Bearer ${token}`).expect(201);
    const rawToken = replacement.body.upload_url.split('/').pop()!;
    const storedLink = getDb().prepare('SELECT token_hash FROM student_photo_upload_links WHERE student_id = ? ORDER BY created_at DESC LIMIT 1').get('stu-demo-01') as any;
    expect(storedLink.token_hash).not.toBe(rawToken);
    StudentPhotoService.submitPhoto(rawToken, jpeg);
    expect((getDb().prepare("SELECT status FROM student_photo_submissions WHERE student_id = ? ORDER BY submitted_at DESC LIMIT 1").get('stu-demo-01') as any).status).toBe('PENDING_REVIEW');
    const history = StudentPhotoService.getReviewHistory('stu-demo-01') as any[];
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ status: 'REJECTED', rejection_reason: 'Face is not clearly visible.' });
    expect(history[1].status).toBe('PENDING_REVIEW');
    expect(() => StudentPhotoService.submitPhoto(rawToken, jpeg)).toThrow(/already been used/i);
  });
});
