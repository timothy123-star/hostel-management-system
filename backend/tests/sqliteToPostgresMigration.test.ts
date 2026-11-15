import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { APPLICATION_TABLES, migrateSqliteData, parseMigrationArgs, preflightSqliteSource, transformRow } from '../src/db/postgres/migrateSqliteData.js';

const fixtures: string[] = [];
function fixture(): string {
  const file = path.join(os.tmpdir(), `hostelos-migration-test-${crypto.randomUUID()}.sqlite`);
  fixtures.push(file);
  const db = new Database(file);
  for (const table of APPLICATION_TABLES) db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY)`);
  db.exec('DROP TABLE students; CREATE TABLE students (id TEXT PRIMARY KEY, phone_number TEXT, gender TEXT, consent_random_matching INTEGER, created_at TEXT);');
  db.exec('DROP TABLE audit_logs; CREATE TABLE audit_logs (id TEXT PRIMARY KEY, action TEXT, created_at TEXT);');
  db.exec('DROP TABLE admin_users; CREATE TABLE admin_users (id TEXT PRIMARY KEY, username TEXT, password_hash TEXT, created_at TEXT);');
  db.exec('DROP TABLE hostels; CREATE TABLE hostels (id TEXT PRIMARY KEY, code TEXT, created_at TEXT);');
  db.exec('DROP TABLE rooms; CREATE TABLE rooms (id TEXT PRIMARY KEY, hostel_id TEXT, price_per_student REAL, created_at TEXT);');
  db.exec('DROP TABLE student_photo_submissions; CREATE TABLE student_photo_submissions (id TEXT PRIMARY KEY, student_id TEXT, storage_key TEXT, submitted_at TEXT);');
  db.exec('DROP TABLE student_photo_requests; CREATE TABLE student_photo_requests (id TEXT PRIMARY KEY, student_id TEXT, status TEXT, requested_at TEXT);');
  db.exec('DROP TABLE student_photo_upload_links; CREATE TABLE student_photo_upload_links (id TEXT PRIMARY KEY, student_id TEXT, token_hash TEXT, created_at TEXT);');
  db.exec('DROP TABLE booking_groups; CREATE TABLE booking_groups (id TEXT PRIMARY KEY, hostel_id TEXT, created_by_student_id TEXT, created_at TEXT);');
  db.exec('DROP TABLE booking_group_members; CREATE TABLE booking_group_members (id TEXT PRIMARY KEY, group_id TEXT, student_id TEXT, joined_at TEXT);');
  db.exec('DROP TABLE matching_queue; CREATE TABLE matching_queue (id TEXT PRIMARY KEY, student_id TEXT, hostel_id TEXT, queued_at TEXT);');
  db.exec('DROP TABLE payments; CREATE TABLE payments (id TEXT PRIMARY KEY, student_id TEXT, booking_group_id TEXT, amount REAL, created_at TEXT);');
  db.exec('DROP TABLE demo_bank_transactions; CREATE TABLE demo_bank_transactions (id TEXT PRIMARY KEY, linked_payment_id TEXT, amount REAL, transaction_timestamp TEXT, created_at TEXT);');
  db.exec('DROP TABLE room_allocations; CREATE TABLE room_allocations (id TEXT PRIMARY KEY, room_id TEXT, student_id TEXT, booking_group_id TEXT, accommodation_start_date TEXT, accommodation_end_date TEXT, created_at TEXT);');
  db.exec('DROP TABLE qr_credentials; CREATE TABLE qr_credentials (id TEXT PRIMARY KEY, student_id TEXT, room_allocation_id TEXT, token_hash TEXT, issued_at TEXT);');
  db.exec('DROP TABLE resident_qr_credentials; CREATE TABLE resident_qr_credentials (id TEXT PRIMARY KEY, student_id TEXT, issued_for_allocation_id TEXT, token_hash TEXT, issued_at TEXT);');
  db.exec('DROP TABLE access_logs; CREATE TABLE access_logs (id TEXT PRIMARY KEY, logged_at TEXT);');
  db.exec('DROP TABLE announcements; CREATE TABLE announcements (id TEXT PRIMARY KEY, created_at TEXT);');
  db.exec('DROP TABLE announcement_recipients; CREATE TABLE announcement_recipients (id TEXT PRIMARY KEY, announcement_id TEXT, student_id TEXT, sent_at TEXT);');
  db.exec('DROP TABLE notification_preferences; CREATE TABLE notification_preferences (id TEXT PRIMARY KEY, student_id TEXT, updated_at TEXT);');
  db.exec('DROP TABLE notification_logs; CREATE TABLE notification_logs (id TEXT PRIMARY KEY, student_id TEXT, sent_at TEXT);');
  db.exec('DROP TABLE whatsapp_conversations; CREATE TABLE whatsapp_conversations (id TEXT PRIMARY KEY, phone_number TEXT, state_payload TEXT, created_at TEXT);');
  db.exec('DROP TABLE whatsapp_processed_messages; CREATE TABLE whatsapp_processed_messages (id TEXT PRIMARY KEY, message_id TEXT, processed_at TEXT);');
  db.exec('DROP TABLE whatsapp_photo_disclosures; CREATE TABLE whatsapp_photo_disclosures (phone_number TEXT PRIMARY KEY, student_id TEXT, disclosure_version TEXT, shown_at TEXT, created_at TEXT);');
  db.close();
  return file;
}
afterEach(() => { while (fixtures.length) fs.rmSync(fixtures.pop()!, { force: true }); });

describe('SQLite-to-PostgreSQL migration safety', () => {
  it('requires explicit source syntax and rejects missing sources', () => {
    expect(() => parseMigrationArgs([])).toThrow(/source path/i);
    expect(() => preflightSqliteSource(path.join(os.tmpdir(), 'missing-hostelos.sqlite'))).toThrow(/does not exist/i);
  });
  it('dry-runs all 24 tables without creating a PostgreSQL pool', async () => {
    const report = await migrateSqliteData({ sourcePath: fixture(), allowSynthetic: true });
    expect(report.outcome).toBe('DRY_RUN');
    expect(report.tables).toHaveLength(24);
    expect(report.tables.every(table => table.result === 'DRY_RUN')).toBe(true);
  });
  it('rejects synthetic data unless explicitly authorized', () => {
    const file = fixture();
    const db = new Database(file); db.prepare("INSERT INTO students VALUES ('stu-demo-01', 'x', 'MALE', 0, '2026-01-01T00:00:00Z')").run(); db.close();
    expect(() => preflightSqliteSource(file)).toThrow(/synthetic/i);
    const allowed = preflightSqliteSource(file, true);
    allowed.db.close();
  });
  it('validates booleans, timezone-qualified timestamps, dates, and JSON without guessing', () => {
    expect(transformRow('students', { id: 's', consent_random_matching: 1, created_at: '2026-01-01T00:00:00Z' }).consent_random_matching).toBe(true);
    expect(() => transformRow('students', { id: 's', created_at: '2026-01-01 00:00:00' })).toThrow(/ambiguous/i);
    expect(() => transformRow('audit_logs', { id: 'a', old_values: '{not json}' })).toThrow(/Malformed JSON/i);
    expect(transformRow('room_allocations', { id: 'r', accommodation_start_date: '2026-01-01' }).accommodation_start_date).toBe('2026-01-01');
  });
  it('requires the dedicated destination URL before execute mode', async () => {
    await expect(migrateSqliteData({ sourcePath: fixture(), execute: true, allowSynthetic: true })).rejects.toThrow(/PG_MIGRATION_DATABASE_URL/);
  });
});
