# PostgreSQL schema conversions

The first PostgreSQL migration represents the 23 HostelOS application tables
without changing the SQLite runtime.

- Text primary and foreign keys remain `TEXT` so current IDs can be preserved.
- SQLite `INTEGER` flags become `BOOLEAN` with equivalent defaults.
- Monetary `REAL` values become `NUMERIC(12,2)`.
- Accommodation date strings become `DATE`; other ISO event times become
  `TIMESTAMPTZ`.
- `audit_logs.old_values`, `audit_logs.new_values`,
  `notification_logs.payload`, and `whatsapp_conversations.state_payload`
  become `JSONB`. A future data-import utility must validate each legacy value
  before insertion and report invalid JSON rather than coercing it.
- Statuses remain checked `TEXT` values, not PostgreSQL enums.
- `qr_image_data` remains `TEXT`; no credential or photograph data is exposed
  by this schema.
