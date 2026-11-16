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
  role TEXT NOT NULL DEFAULT 'MANAGER' CHECK (role IN ('MANAGER', 'SECURITY')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
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
  photo_storage_key TEXT,
  photo_status TEXT NOT NULL DEFAULT 'NOT_SUBMITTED' CHECK (photo_status IN ('NOT_SUBMITTED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_students_phone ON students(phone_number);
CREATE INDEX IF NOT EXISTS idx_students_gender ON students(gender);

-- Every submitted image is retained for the manager review history. The current
-- student photo fields point to the most recent submission only.
CREATE TABLE IF NOT EXISTS student_photo_submissions (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED')),
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_by_admin_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  rejection_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_photo_submissions_review ON student_photo_submissions(status, submitted_at);
CREATE INDEX IF NOT EXISTS idx_photo_submissions_student ON student_photo_submissions(student_id, submitted_at);


-- Tracks requests for students to submit photographs directly through WhatsApp.
CREATE TABLE IF NOT EXISTS student_photo_requests (
  id TEXT PRIMARY KEY,

  student_id TEXT NOT NULL
    REFERENCES students(id) ON DELETE CASCADE,

  source TEXT NOT NULL
    CHECK (source IN ('STUDENT', 'MANAGER')),

  requested_by_admin_id TEXT
    REFERENCES admin_users(id) ON DELETE SET NULL,

  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'FULFILLED', 'CANCELLED', 'EXPIRED')),

  requested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  fulfilled_at TEXT,

  submission_id TEXT UNIQUE
    REFERENCES student_photo_submissions(id) ON DELETE SET NULL
);

-- A student may have only one pending photo request at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_photo_one_pending_request
ON student_photo_requests(student_id)
WHERE status = 'PENDING';

-- Supports retrieving request history for an individual student.
CREATE INDEX IF NOT EXISTS idx_student_photo_requests_student
ON student_photo_requests(student_id, requested_at);

-- Supports finding requests awaiting photographs or requiring expiry.
CREATE INDEX IF NOT EXISTS idx_student_photo_requests_status_expiry
ON student_photo_requests(status, expires_at);

-- Secure, single-use links. Raw tokens are never persisted.
CREATE TABLE IF NOT EXISTS student_photo_upload_links (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  invalidated_at TEXT,
  created_by_admin_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_photo_upload_links_student ON student_photo_upload_links(student_id, expires_at);

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
  auto_complete_triple_consent INTEGER NOT NULL DEFAULT 0 CHECK (auto_complete_triple_consent IN (0, 1)),
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
  auto_complete_triple_consent INTEGER NOT NULL DEFAULT 0 CHECK (auto_complete_triple_consent IN (0, 1)),
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
  reconciliation_status TEXT NOT NULL DEFAULT 'NOT_SUBMITTED' CHECK (reconciliation_status IN ('NOT_SUBMITTED', 'AWAITING_RECONCILIATION', 'RECONCILED', 'EXCEPTION', 'REJECTED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(student_id, booking_group_id)
);
CREATE INDEX IF NOT EXISTS idx_payments_group ON payments(booking_group_id, status);

-- 8b. DEMO ONLY incoming bank ledger. This is intentionally provider-separated.
CREATE TABLE IF NOT EXISTS demo_bank_transactions (
  id TEXT PRIMARY KEY,
  provider_type TEXT NOT NULL DEFAULT 'DEMO_BANK',
  bank_transaction_reference TEXT NOT NULL UNIQUE,
  beneficiary_account TEXT NOT NULL,
  payment_reference TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  transaction_timestamp TEXT NOT NULL,
  sender_description TEXT NOT NULL,
  reconciliation_status TEXT NOT NULL DEFAULT 'PENDING_RECONCILIATION' CHECK (reconciliation_status IN ('PENDING_RECONCILIATION', 'RECONCILED', 'EXCEPTION', 'REJECTED')),
  linked_payment_id TEXT UNIQUE REFERENCES payments(id) ON DELETE RESTRICT,
  reconciled_at TEXT,
  reconciled_by_admin_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  exception_reason TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_demo_bank_transactions_status ON demo_bank_transactions(reconciliation_status, created_at);

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

-- Reissuable individual credentials. The legacy qr_credentials table is kept
-- intact as historical data from the pre-photo-approval implementation.
CREATE TABLE IF NOT EXISTS resident_qr_credentials (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  issued_for_allocation_id TEXT NOT NULL REFERENCES room_allocations(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  issued_by_admin_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  revoked_by_admin_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  revoke_reason TEXT,
  reissued_from_credential_id TEXT REFERENCES resident_qr_credentials(id) ON DELETE SET NULL,
  last_verified_at TEXT,
  token_ciphertext TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_resident_qr_one_active ON resident_qr_credentials(student_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_resident_qr_token_hash ON resident_qr_credentials(token_hash);

-- 11. Access Logs (Verification records)
CREATE TABLE IF NOT EXISTS access_logs (
  id TEXT PRIMARY KEY,
  qr_credential_id TEXT REFERENCES qr_credentials(id) ON DELETE SET NULL,
  resident_qr_credential_id TEXT REFERENCES resident_qr_credentials(id) ON DELETE SET NULL,
  student_id TEXT REFERENCES students(id) ON DELETE SET NULL,
  verified_by_admin_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  verification_method TEXT NOT NULL CHECK (verification_method IN ('CAMERA', 'MANUAL_ENTRY')),
  verification_channel TEXT NOT NULL DEFAULT 'MANAGER' CHECK (verification_channel IN ('MANAGER', 'PUBLIC_BROWSER')),
  outcome TEXT NOT NULL CHECK (outcome IN ('GRANTED', 'DENIED')),
  reason TEXT,
  staff_role TEXT NOT NULL DEFAULT 'MANAGER' CHECK (staff_role IN ('MANAGER', 'SECURITY')),
  credential_fingerprint TEXT,
  logged_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_access_logs_time ON access_logs(logged_at);
CREATE INDEX IF NOT EXISTS idx_access_logs_credential ON access_logs(resident_qr_credential_id, logged_at);

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

-- 19. WhatsApp inbound inbox (durable, retryable pre-processing queue).
-- Webhook payloads are persisted here BEFORE the HTTP 200 acknowledgement;
-- the worker marks rows PROCESSED only after successful handling.
CREATE TABLE IF NOT EXISTS whatsapp_inbound_inbox (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  from_number TEXT NOT NULL,
  text_body TEXT,
  button_id TEXT,
  has_image INTEGER NOT NULL DEFAULT 0,
  image_id TEXT,
  image_mime TEXT,
  message_type TEXT NOT NULL DEFAULT 'text',
  status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'RETRYABLE', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wa_inbox_status ON whatsapp_inbound_inbox(status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_wa_inbox_message ON whatsapp_inbound_inbox(message_id);


-- LLM_4123256751313927_LBzSxS8KWm-lDIJGoDXjWfQaKe0
-- 11. WhatsApp resident notification outbox (durable, idempotent).
CREATE TABLE IF NOT EXISTS whatsapp_notifications (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  student_id TEXT REFERENCES students(id) ON DELETE SET NULL,
  phone_number TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('PAYMENT_APPROVED','PAYMENT_REJECTED','PHOTO_APPROVED','PHOTO_REJECTED','QR_ISSUED')),
  body_text TEXT NOT NULL,
  template_name TEXT,
  template_params TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','SENT','FAILED','PENDING_TEMPLATE')),
  meta_message_id TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_wa_notifications_status ON whatsapp_notifications(status, created_at);
CREATE INDEX IF NOT EXISTS idx_wa_notifications_student ON whatsapp_notifications(student_id, created_at);

-- Explicit, separately auditable consent for public QR photo display.
-- Submission/approval consent does NOT imply display consent.
CREATE TABLE IF NOT EXISTS photo_display_consents (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL DEFAULT 'QR_VERIFICATION_DISPLAY' CHECK (purpose = 'QR_VERIFICATION_DISPLAY'),
  decision TEXT NOT NULL CHECK (decision IN ('GRANTED','DECLINED','WITHDRAWN')),
  decided_by TEXT NOT NULL CHECK (decided_by IN ('RESIDENT','MANAGER')),
  decided_by_admin_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_photo_display_consents_student ON photo_display_consents(student_id, created_at);

-- Durable record that the photo-display disclosure (PHOTO_UPLOAD_DISCLOSURE_VERSION)
-- was shown to a WhatsApp sender before their photograph was accepted. An upload
-- only records display permission when a row for the current disclosure version
-- already exists; the first image after registration therefore triggers the
-- disclosure plus a resend request instead of being processed silently.

-- 20. WhatsApp conversation archives (durable record of losing rows).
-- Migrate-on-read never deletes a conversation row without archiving it
-- here first, in the same transaction.
CREATE TABLE IF NOT EXISTS whatsapp_photo_disclosures (
  phone_number TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  disclosure_version TEXT NOT NULL,
  shown_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wa_photo_disclosures_student ON whatsapp_photo_disclosures(student_id, shown_at);

CREATE TABLE IF NOT EXISTS whatsapp_conversation_archives (
  id TEXT PRIMARY KEY,
  archived_conversation_id TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  current_state TEXT NOT NULL,
  state_payload TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wa_conv_archives_phone ON whatsapp_conversation_archives(phone_number, created_at);
