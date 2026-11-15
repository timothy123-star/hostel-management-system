-- Additive migration: durable WhatsApp photo-display disclosure record.
-- Replacement continuity needs no schema change: students.photo_storage_key
-- remains the single source of truth for the active photograph, while
-- non-current PENDING_REVIEW rows are replacement candidates.
CREATE TABLE IF NOT EXISTS whatsapp_photo_disclosures (
  phone_number TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  disclosure_version TEXT NOT NULL,
  shown_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_wa_photo_disclosures_student ON whatsapp_photo_disclosures(student_id, shown_at);
