import { describe, it, expect, beforeEach } from 'vitest';
import { runSeed } from '../src/db/seed.js';
import { QRService } from '../src/services/qrService.js';
import { getDb } from '../src/db/connection.js';

describe('QR Digital Identity & Verification Rules', () => {
  beforeEach(async () => {
    await runSeed(true);
  });

  it('generates an unpredictable cryptographic token without leaking plaintext student data in QR content', () => {
    const { token, tokenHash } = QRService.generateToken();
    expect(token.length).toBe(64); // 32 random bytes in hex
    expect(tokenHash.length).toBe(64); // sha256 hex
    expect(token).not.toContain('John');
    expect(token).not.toContain('+1555');
  });

  it('grants access for an active valid QR credential and verifies student details', () => {
    // John Doe has active credential in seed
    const db = getDb();
    const cred = db.prepare('SELECT * FROM qr_credentials WHERE student_id = \'stu-demo-01\'').get() as any;
    expect(cred).toBeDefined();

    // Verify token hash match
    const result = QRService.verifyToken(cred.token_hash, 'admin-root-01', 'MANUAL_ENTRY');
    expect(result.outcome).toBe('GRANTED');
    expect(result.student.full_name).toContain('John Doe');
    expect(result.hostel.code).toBe('MALE');
    expect(result.room.room_number).toBe('M-101');
  });

  it('denies access when a QR credential is REVOKED by management', () => {
    // Peter Capaldi is revoked in seed
    const db = getDb();
    const cred = db.prepare('SELECT * FROM qr_credentials WHERE student_id = \'stu-demo-11\'').get() as any;
    expect(cred).toBeDefined();
    expect(cred.status).toBe('REVOKED');

    const result = QRService.verifyToken(cred.token_hash, 'admin-root-01', 'MANUAL_ENTRY');
    expect(result.outcome).toBe('DENIED');
    expect(result.reason).toContain('revoked');
  });

  it('denies access for an unrecognised/invalid token without crashing', () => {
    const fakeToken = 'totally-fake-unrecognised-qr-pass-token-12345';
    const result = QRService.verifyToken(fakeToken, 'admin-root-01', 'CAMERA');
    expect(result.outcome).toBe('DENIED');
    expect(result.reason).toContain('Invalid or unrecognised');
  });

  it('is idempotent: does not mint a new identity token when an existing active QR is requested', async () => {
    const firstCall = await QRService.getOrIssueCredential('stu-demo-01', 'alloc-demo-01');
    const secondCall = await QRService.getOrIssueCredential('stu-demo-01', 'alloc-demo-01');

    expect(firstCall.credential.id).toBe(secondCall.credential.id);
    expect(firstCall.credential.token_hash).toBe(secondCall.credential.token_hash);
  });
});
