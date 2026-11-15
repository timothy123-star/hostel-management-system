-- HostelOS PostgreSQL foundation. Additive only; executed explicitly by migrate.ts.

CREATE TABLE admin_users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL, email TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE hostels (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE CHECK (code IN ('MALE', 'FEMALE')),
  name TEXT NOT NULL, description TEXT NOT NULL, total_capacity INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE rooms (
  id TEXT PRIMARY KEY, hostel_id TEXT NOT NULL REFERENCES hostels(id) ON DELETE RESTRICT,
  room_number TEXT NOT NULL, capacity INTEGER NOT NULL CHECK (capacity IN (1, 2, 3)),
  price_per_student NUMERIC(12,2) NOT NULL CHECK (price_per_student >= 0),
  status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'OCCUPIED', 'MAINTENANCE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hostel_id, room_number)
);
CREATE INDEX idx_rooms_hostel_status ON rooms(hostel_id, status);
CREATE TABLE students (
  id TEXT PRIMARY KEY, full_name TEXT NOT NULL, phone_number TEXT NOT NULL UNIQUE,
  gender TEXT NOT NULL CHECK (gender IN ('MALE', 'FEMALE')), department TEXT NOT NULL, academic_level TEXT NOT NULL,
  preferred_occupancy INTEGER NOT NULL CHECK (preferred_occupancy IN (1, 2, 3)),
  roommate_mode TEXT NOT NULL CHECK (roommate_mode IN ('KNOWN', 'RANDOM')),
  consent_random_matching BOOLEAN NOT NULL DEFAULT FALSE, photo_url TEXT, photo_storage_key TEXT,
  photo_status TEXT NOT NULL DEFAULT 'NOT_SUBMITTED' CHECK (photo_status IN ('NOT_SUBMITTED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_students_phone ON students(phone_number);
CREATE INDEX idx_students_gender ON students(gender);
CREATE TABLE student_photo_submissions (
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by_admin_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL, reviewed_at TIMESTAMPTZ, rejection_reason TEXT
);
CREATE INDEX idx_photo_submissions_review ON student_photo_submissions(status, submitted_at);
CREATE INDEX idx_photo_submissions_student ON student_photo_submissions(student_id, submitted_at);
CREATE TABLE student_photo_requests (
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('STUDENT', 'MANAGER')),
  requested_by_admin_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'FULFILLED', 'CANCELLED', 'EXPIRED')),
  requested_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL, fulfilled_at TIMESTAMPTZ,
  submission_id TEXT UNIQUE REFERENCES student_photo_submissions(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX idx_student_photo_one_pending_request ON student_photo_requests(student_id) WHERE status = 'PENDING';
CREATE INDEX idx_student_photo_requests_student ON student_photo_requests(student_id, requested_at);
CREATE INDEX idx_student_photo_requests_status_expiry ON student_photo_requests(status, expires_at);
CREATE TABLE student_photo_upload_links (
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, invalidated_at TIMESTAMPTZ,
  created_by_admin_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_photo_upload_links_student ON student_photo_upload_links(student_id, expires_at);
CREATE TABLE booking_groups (
  id TEXT PRIMARY KEY, group_code TEXT NOT NULL UNIQUE, hostel_id TEXT NOT NULL REFERENCES hostels(id) ON DELETE RESTRICT,
  target_capacity INTEGER NOT NULL CHECK (target_capacity IN (1, 2, 3)),
  status TEXT NOT NULL DEFAULT 'FORMING' CHECK (status IN ('FORMING', 'READY_FOR_ALLOCATION', 'ALLOCATED', 'CANCELLED')),
  created_by_student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT, eligible_at TIMESTAMPTZ,
  held_room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL, auto_complete_triple_consent BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_groups_hostel_status ON booking_groups(hostel_id, status);
CREATE TABLE booking_group_members (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES booking_groups(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('LEADER', 'MEMBER')),
  is_matched_from_queue BOOLEAN NOT NULL DEFAULT FALSE, auto_complete_triple_consent BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(group_id, student_id)
);
CREATE INDEX idx_group_members_student ON booking_group_members(student_id);
CREATE TABLE matching_queue (
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  hostel_id TEXT NOT NULL REFERENCES hostels(id) ON DELETE RESTRICT,
  target_capacity INTEGER NOT NULL CHECK (target_capacity IN (2, 3)),
  status TEXT NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING', 'MATCHED', 'CANCELLED')),
  queued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, matched_at TIMESTAMPTZ,
  matched_group_id TEXT REFERENCES booking_groups(id) ON DELETE SET NULL
);
CREATE INDEX idx_matching_queue_lookup ON matching_queue(hostel_id, target_capacity, status, queued_at);
CREATE TABLE payments (
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  booking_group_id TEXT NOT NULL REFERENCES booking_groups(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0), currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'REJECTED')),
  reference_code TEXT NOT NULL UNIQUE, verified_by_admin_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ, notes TEXT,
  reconciliation_status TEXT NOT NULL DEFAULT 'NOT_SUBMITTED' CHECK (reconciliation_status IN ('NOT_SUBMITTED', 'AWAITING_RECONCILIATION', 'RECONCILED', 'EXCEPTION', 'REJECTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(student_id, booking_group_id)
);
CREATE INDEX idx_payments_group ON payments(booking_group_id, status);
CREATE TABLE demo_bank_transactions (
  id TEXT PRIMARY KEY, provider_type TEXT NOT NULL DEFAULT 'DEMO_BANK', bank_transaction_reference TEXT NOT NULL UNIQUE,
  beneficiary_account TEXT NOT NULL, payment_reference TEXT NOT NULL, amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'USD', transaction_timestamp TIMESTAMPTZ NOT NULL, sender_description TEXT NOT NULL,
  reconciliation_status TEXT NOT NULL DEFAULT 'PENDING_RECONCILIATION' CHECK (reconciliation_status IN ('PENDING_RECONCILIATION', 'RECONCILED', 'EXCEPTION', 'REJECTED')),
  linked_payment_id TEXT UNIQUE REFERENCES payments(id) ON DELETE RESTRICT, reconciled_at TIMESTAMPTZ,
  reconciled_by_admin_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL, exception_reason TEXT,
  idempotency_key TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_demo_bank_transactions_status ON demo_bank_transactions(reconciliation_status, created_at);
CREATE TABLE room_allocations (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  booking_group_id TEXT NOT NULL REFERENCES booking_groups(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'HOLD' CHECK (status IN ('HOLD', 'FINALIZED', 'CANCELLED', 'MOVED')),
  allocated_by_admin_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  accommodation_start_date DATE NOT NULL, accommodation_end_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_allocations_room ON room_allocations(room_id, status);
CREATE INDEX idx_allocations_student ON room_allocations(student_id, status);
CREATE INDEX idx_allocations_expiry ON room_allocations(accommodation_end_date);
CREATE TABLE qr_credentials (
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  room_allocation_id TEXT NOT NULL REFERENCES room_allocations(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, revoked_at TIMESTAMPTZ, revoke_reason TEXT,
  last_issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, qr_image_data TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(student_id, room_allocation_id)
);
CREATE INDEX idx_qr_token_hash ON qr_credentials(token_hash);
CREATE TABLE resident_qr_credentials (
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  issued_for_allocation_id TEXT NOT NULL REFERENCES room_allocations(id) ON DELETE RESTRICT, token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  issued_by_admin_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, revoked_at TIMESTAMPTZ,
  revoked_by_admin_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL, revoke_reason TEXT,
  reissued_from_credential_id TEXT REFERENCES resident_qr_credentials(id) ON DELETE SET NULL,
  last_verified_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_resident_qr_one_active ON resident_qr_credentials(student_id) WHERE status = 'ACTIVE';
CREATE INDEX idx_resident_qr_token_hash ON resident_qr_credentials(token_hash);
CREATE TABLE access_logs (
  id TEXT PRIMARY KEY, qr_credential_id TEXT REFERENCES qr_credentials(id) ON DELETE SET NULL,
  resident_qr_credential_id TEXT REFERENCES resident_qr_credentials(id) ON DELETE SET NULL,
  student_id TEXT REFERENCES students(id) ON DELETE SET NULL, verified_by_admin_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  verification_method TEXT NOT NULL CHECK (verification_method IN ('CAMERA', 'MANUAL_ENTRY')),
  verification_channel TEXT NOT NULL DEFAULT 'MANAGER' CHECK (verification_channel IN ('MANAGER', 'PUBLIC_BROWSER')),
  outcome TEXT NOT NULL CHECK (outcome IN ('GRANTED', 'DENIED')), reason TEXT,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_access_logs_time ON access_logs(logged_at);
CREATE TABLE announcements (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, message TEXT NOT NULL,
  target_audience TEXT NOT NULL CHECK (target_audience IN ('ALL', 'MALE', 'FEMALE', 'EXPIRING_SOON', 'CUSTOM')),
  sent_by_admin_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'QUEUED', 'SENT', 'SIMULATED', 'FAILED')),
  total_recipients INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, sent_at TIMESTAMPTZ
);
CREATE TABLE announcement_recipients (
  id TEXT PRIMARY KEY, announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE, phone_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENT', 'SIMULATED', 'DELIVERED', 'FAILED')),
  failure_reason TEXT, sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_announcement_recipients ON announcement_recipients(announcement_id);
CREATE TABLE notification_preferences (
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL UNIQUE REFERENCES students(id) ON DELETE CASCADE,
  whatsapp_enabled BOOLEAN NOT NULL DEFAULT TRUE, renewal_reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  announcements_enabled BOOLEAN NOT NULL DEFAULT TRUE, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE notification_logs (
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'WHATSAPP',
  status TEXT NOT NULL CHECK (status IN ('SIMULATED', 'SENT', 'FAILED')), payload JSONB,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_notification_logs_student ON notification_logs(student_id);
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY, admin_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  old_values JSONB, new_values JSONB, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
CREATE TABLE whatsapp_conversations (
  id TEXT PRIMARY KEY, phone_number TEXT NOT NULL UNIQUE, current_state TEXT NOT NULL DEFAULT 'IDLE',
  state_payload JSONB NOT NULL DEFAULT '{}'::jsonb, last_active_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_wa_conv_phone ON whatsapp_conversations(phone_number);
CREATE TABLE whatsapp_processed_messages (
  id TEXT PRIMARY KEY, message_id TEXT NOT NULL UNIQUE, phone_number TEXT NOT NULL, message_type TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND')), payload JSONB,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_wa_msg_id ON whatsapp_processed_messages(message_id);
