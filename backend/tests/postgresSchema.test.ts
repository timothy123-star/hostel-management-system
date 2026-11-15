import fs from 'fs';
import { describe, expect, it } from 'vitest';

const schema = fs.readFileSync(new URL('../src/db/postgres/migrations/0001_initial_schema.sql', import.meta.url), 'utf8');

describe('PostgreSQL initial schema', () => {
  it('represents all 23 HostelOS application tables and their key type conversions', () => {
    const tables = [...schema.matchAll(/^CREATE TABLE (\w+)/gm)].map(match => match[1]);
    expect(tables).toEqual([
      'admin_users', 'hostels', 'rooms', 'students', 'student_photo_submissions', 'student_photo_requests',
      'student_photo_upload_links', 'booking_groups', 'booking_group_members', 'matching_queue', 'payments',
      'demo_bank_transactions', 'room_allocations', 'qr_credentials', 'resident_qr_credentials', 'access_logs',
      'announcements', 'announcement_recipients', 'notification_preferences', 'notification_logs', 'audit_logs',
      'whatsapp_conversations', 'whatsapp_processed_messages'
    ]);
    expect(schema).toContain('price_per_student NUMERIC(12,2)');
    expect(schema).toContain('consent_random_matching BOOLEAN');
    expect(schema).toContain('accommodation_start_date DATE');
    expect(schema).toContain('created_at TIMESTAMPTZ');
    expect(schema).toContain('state_payload JSONB');
    expect(schema).toContain('idx_resident_qr_one_active');
    expect(schema).toContain('ON DELETE CASCADE');
  });
});
