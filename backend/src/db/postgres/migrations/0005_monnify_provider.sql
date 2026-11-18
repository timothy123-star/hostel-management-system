-- Additive Monnify provider migration. Legacy USD demo rows are untouched.
CREATE TABLE IF NOT EXISTS payment_attempts (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL DEFAULT 'MONNIFY' CHECK (provider = 'MONNIFY'),
  merchant_reference TEXT NOT NULL UNIQUE,
  monnify_transaction_reference TEXT UNIQUE,
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  account_number TEXT,
  bank_name TEXT,
  account_name TEXT,
  account_expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RECONCILED','MISMATCH','EXPIRED','FAILED','REVERSED','SUPERSEDED')),
  provider_metadata TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_payment ON payment_attempts(payment_id, created_at);
CREATE TABLE IF NOT EXISTS monnify_webhook_events (
  id TEXT PRIMARY KEY,
  event_hash TEXT NOT NULL UNIQUE,
  payment_reference TEXT,
  transaction_reference TEXT,
  raw_payload TEXT NOT NULL,
  signature_present BOOLEAN NOT NULL DEFAULT FALSE,
  signature_valid BOOLEAN,
  processing_status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (processing_status IN ('RECEIVED','PROCESSED','DUPLICATE','FAILED')),
  processing_result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_monnify_webhook_refs ON monnify_webhook_events(payment_reference, transaction_reference);
CREATE TABLE IF NOT EXISTS official_session_prices (
  capacity INTEGER PRIMARY KEY CHECK (capacity IN (1, 2, 3)),
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  updated_by_admin_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO official_session_prices (capacity, amount_kobo, currency) VALUES (1, 240000000, 'NGN') ON CONFLICT (capacity) DO NOTHING;
INSERT INTO official_session_prices (capacity, amount_kobo, currency) VALUES (2, 120000000, 'NGN') ON CONFLICT (capacity) DO NOTHING;
INSERT INTO official_session_prices (capacity, amount_kobo, currency) VALUES (3, 80000000, 'NGN') ON CONFLICT (capacity) DO NOTHING;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount_kobo BIGINT CHECK (amount_kobo IS NULL OR amount_kobo > 0);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'DEMO_BANK';
ALTER TABLE booking_groups ADD COLUMN IF NOT EXISTS billing_currency TEXT NOT NULL DEFAULT 'NGN';
UPDATE booking_groups SET billing_currency = 'USD' WHERE id IN (SELECT DISTINCT booking_group_id FROM payments WHERE currency = 'USD' AND amount_kobo IS NULL) AND billing_currency = 'NGN';
