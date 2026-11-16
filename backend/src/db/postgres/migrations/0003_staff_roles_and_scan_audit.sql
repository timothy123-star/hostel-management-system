-- Additive migration: role-based access (MANAGER / SECURITY) and scan audit.
-- Existing administrator rows keep full MANAGER privileges via the default.
ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'MANAGER' CHECK (role IN ('MANAGER', 'SECURITY'));
ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1));
ALTER TABLE access_logs
  ADD COLUMN IF NOT EXISTS staff_role TEXT NOT NULL DEFAULT 'MANAGER' CHECK (staff_role IN ('MANAGER', 'SECURITY'));
ALTER TABLE access_logs
  ADD COLUMN IF NOT EXISTS credential_fingerprint TEXT;
CREATE INDEX IF NOT EXISTS idx_access_logs_credential ON access_logs(resident_qr_credential_id, logged_at);
