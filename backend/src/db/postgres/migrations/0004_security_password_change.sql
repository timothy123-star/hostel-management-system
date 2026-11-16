-- Additive migration: mandatory first-login password change for SECURITY staff.
-- Existing MANAGER rows are unaffected (flag defaults to FALSE); pre-existing
-- SECURITY rows are flagged because they may still hold a temporary password.
ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE admin_users SET must_change_password = TRUE WHERE role = 'SECURITY' AND must_change_password = FALSE;
