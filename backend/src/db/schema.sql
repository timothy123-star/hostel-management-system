-- Digital Hostel Booking, Management and Security System
-- SQLite Normalized Schema

PRAGMA foreign_keys = ON;

-- 1. Administrator Users
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Hostels (Male & Female Independent Facilities)
CREATE TABLE IF NOT EXISTS hostels (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE CHECK (code IN ('MALE', 'FEMALE')),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  total_capacity INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 3. Rooms
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  hostel_id TEXT NOT NULL REFERENCES hostels(id) ON DELETE RESTRICT,
  room_number TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity IN (1, 2, 3)),
  price_per_student REAL NOT NULL CHECK (price_per_student >= 0),
  status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'OCCUPIED', 'MAINTENANCE')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(hostel_id, room_number)
);
CREATE INDEX IF NOT EXISTS idx_rooms_hostel_status ON rooms(hostel_id, status);

-- 4. Students
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone_number TEXT NOT NULL UNIQUE,
  gender TEXT NOT NULL CHECK (gender IN ('MALE', 'FEMALE')),
  department TEXT NOT NULL,
  academic_level TEXT NOT NULL,
  preferred_occupancy INTEGER NOT NULL CHECK (preferred_occupancy IN (1, 2, 3)),
  roommate_mode TEXT NOT NULL CHECK (roommate_mode IN ('KNOWN', 'RANDOM')),
  consent_random_matching INTEGER NOT NULL DEFAULT 0 CHECK (consent_random_matching IN (0, 1)),
  photo_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_students_phone ON students(phone_number);
CREATE INDEX IF NOT EXISTS idx_students_gender ON students(gender);

-- 5. Booking Groups
CREATE TABLE IF NOT EXISTS booking_groups (
  id TEXT PRIMARY KEY,
  group_code TEXT NOT NULL UNIQUE,
  hostel_id TEXT NOT NULL REFERENCES hostels(id) ON DELETE RESTRICT,
  target_capacity INTEGER NOT NULL CHECK (target_capacity IN (1, 2, 3)),
  status TEXT NOT NULL DEFAULT 'FORMING' CHECK (status IN ('FORMING', 'READY_FOR_ALLOCATION', 'ALLOCATED', 'CANCELLED')),
  created_by_student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  eligible_at TEXT,
  held_room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_groups_hostel_status ON booking_groups(hostel_id, status);

-- 6. Booking Group Members
CREATE TABLE IF NOT EXISTS booking_group_members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES booking_groups(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('LEADER', 'MEMBER')),
  is_matched_from_queue INTEGER NOT NULL DEFAULT 0 CHECK (is_matched_from_queue IN (0, 1)),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(group_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_group_members_student ON booking_group_members(student_id);

-- 7. Matching Queue (Consent-based Random Matching)
CREATE TABLE IF NOT EXISTS matching_queue (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  hostel_id TEXT NOT NULL REFERENCES hostels(id) ON DELETE RESTRICT,
  target_capacity INTEGER NOT NULL CHECK (target_capacity IN (2, 3)),
  status TEXT NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING', 'MATCHED', 'CANCELLED')),
  queued_at TEXT NOT NULL DEFAULT (datetime('now')),
  matched_at TEXT,
  matched_group_id TEXT REFERENCES booking_groups(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_matching_queue_lookup ON matching_queue(hostel_id, target_capacity, status, queued_at);

-- 8. Payments (Individual student payments)
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  booking_group_id TEXT NOT NULL REFERENCES booking_groups(id) ON DELETE RESTRICT,
  amount REAL NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'REJECTED')),
  reference_code TEXT NOT NULL UNIQUE,
  verified_by_admin_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  verified_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(student_id, booking_group_id)
);
CREATE INDEX IF NOT EXISTS idx_payments_group ON payments(booking_group_id, status);

-- 9. Room Allocations
CREATE TABLE IF NOT EXISTS room_allocations (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  booking_group_id TEXT NOT NULL REFERENCES booking_groups(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'HOLD' CHECK (status IN ('HOLD', 'FINALIZED', 'CANCELLED', 'MOVED')),
  allocated_by_admin_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  accommodation_start_date TEXT NOT NULL,
  accommodation_end_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_allocations_room ON room_allocations(room_id, status);
CREATE INDEX IF NOT EXISTS idx_allocations_student ON room_allocations(student_id, status);
CREATE INDEX IF NOT EXISTS idx_allocations_expiry ON room_allocations(accommodation_end_date);

-- 10. QR Digital Identity Credentials
CREATE TABLE IF NOT EXISTS qr_credentials (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  room_allocation_id TEXT NOT NULL REFERENCES room_allocations(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  revoke_reason TEXT,
  last_issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  qr_image_data TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(student_id, room_allocation_id)
);
CREATE INDEX IF NOT EXISTS idx_qr_token_hash ON qr_credentials(token_hash);

-- 11. Access Logs (Verification records)
CREATE TABLE IF NOT EXISTS access_logs (
  id TEXT PRIMARY KEY,
  qr_credential_id TEXT REFERENCES qr_credentials(id) ON DELETE SET NULL,
  student_id TEXT REFERENCES students(id) ON DELETE SET NULL,
  verified_by_admin_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  verification_method TEXT NOT NULL CHECK (verification_method IN ('CAMERA', 'MANUAL_ENTRY')),
  outcome TEXT NOT NULL CHECK (outcome IN ('GRANTED', 'DENIED')),
  reason TEXT,
  logged_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_access_logs_time ON access_logs(logged_at);

-- 12. Announcements
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  target_audience TEXT NOT NULL CHECK (target_audience IN ('ALL', 'MALE', 'FEMALE', 'EXPIRING_SOON', 'CUSTOM')),
  sent_by_admin_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'QUEUED', 'SENT', 'SIMULATED', 'FAILED')),
  total_recipients INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);

-- 13. Announcement Recipients
CREATE TABLE IF NOT EXISTS announcement_recipients (
  id TEXT PRIMARY KEY,
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENT', 'SIMULATED', 'DELIVERED', 'FAILED')),
  failure_reason TEXT,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_announcement_recipients ON announcement_recipients(announcement_id);

-- 14. Notification Preferences
CREATE TABLE IF NOT EXISTS notification_preferences (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL UNIQUE REFERENCES students(id) ON DELETE CASCADE,
  whatsapp_enabled INTEGER NOT NULL DEFAULT 1,
  renewal_reminders_enabled INTEGER NOT NULL DEFAULT 1,
  announcements_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 15. Notification Logs
CREATE TABLE IF NOT EXISTS notification_logs (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'WHATSAPP',
  status TEXT NOT NULL CHECK (status IN ('SIMULATED', 'SENT', 'FAILED')),
  payload TEXT,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notification_logs_student ON notification_logs(student_id);

-- 16. Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  admin_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  old_values TEXT,
  new_values TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);

-- 17. WhatsApp Conversations
CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id TEXT PRIMARY KEY,
  phone_number TEXT NOT NULL UNIQUE,
  current_state TEXT NOT NULL DEFAULT 'IDLE',
  state_payload TEXT NOT NULL DEFAULT '{}',
  last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wa_conv_phone ON whatsapp_conversations(phone_number);

-- 18. WhatsApp Processed Messages (Idempotency)
CREATE TABLE IF NOT EXISTS whatsapp_processed_messages (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  phone_number TEXT NOT NULL,
  message_type TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND')),
  payload TEXT,
  processed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wa_msg_id ON whatsapp_processed_messages(message_id);
