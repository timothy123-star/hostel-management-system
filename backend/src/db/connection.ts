import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dbInstance: Database.Database | null = null;

export function getDb(customPath?: string): Database.Database {
  if (!dbInstance || customPath) {
    const resolvedPath = customPath || path.resolve(config.dbPath);
    // Railway persistent volume (e.g. /data/hostel.sqlite) may not exist on
    // first boot. Creating only the parent directory never touches the DB.
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    const db = new Database(resolvedPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    if (!customPath) {
      dbInstance = db;
    } else {
      return db;
    }
  }
  return dbInstance;
}

export function initSchema(db: Database.Database) {
  const schemaPath = path.resolve(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(sql);

  // Lightweight forward-only migrations for existing development databases.
  // `CREATE TABLE IF NOT EXISTS` deliberately does not alter an existing table.
  const groupColumns = db.prepare("PRAGMA table_info(booking_groups)").all() as any[];
  if (!groupColumns.some(column => column.name === 'auto_complete_triple_consent')) {
    db.exec('ALTER TABLE booking_groups ADD COLUMN auto_complete_triple_consent INTEGER NOT NULL DEFAULT 0 CHECK (auto_complete_triple_consent IN (0, 1))');
  }

  const memberColumns = db.prepare("PRAGMA table_info(booking_group_members)").all() as any[];
  if (!memberColumns.some(column => column.name === 'auto_complete_triple_consent')) {
    db.exec('ALTER TABLE booking_group_members ADD COLUMN auto_complete_triple_consent INTEGER NOT NULL DEFAULT 0 CHECK (auto_complete_triple_consent IN (0, 1))');
  }

  const paymentColumns = db.prepare("PRAGMA table_info(payments)").all() as any[];
  if (!paymentColumns.some(column => column.name === 'reconciliation_status')) {
    db.exec("ALTER TABLE payments ADD COLUMN reconciliation_status TEXT NOT NULL DEFAULT 'NOT_SUBMITTED'");
  }

  const studentColumns = db.prepare("PRAGMA table_info(students)").all() as any[];
  if (!studentColumns.some(column => column.name === 'photo_storage_key')) {
    db.exec('ALTER TABLE students ADD COLUMN photo_storage_key TEXT');
  }
  if (!studentColumns.some(column => column.name === 'photo_status')) {
    db.exec("ALTER TABLE students ADD COLUMN photo_status TEXT NOT NULL DEFAULT 'NOT_SUBMITTED'");
  }

  try {
    db.exec(`CREATE TABLE IF NOT EXISTS whatsapp_notifications (
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
)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_wa_notifications_status ON whatsapp_notifications(status, created_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_wa_notifications_student ON whatsapp_notifications(student_id, created_at)`);
    const waColumns = db.prepare("PRAGMA table_info(whatsapp_notifications)").all() as any[];
    if (!waColumns.some((column) => column.name === 'template_params')) {
      db.exec('ALTER TABLE whatsapp_notifications ADD COLUMN template_params TEXT');
    }
  } catch { /* table already exists */ }
  try {
    const qrCols = db.prepare("PRAGMA table_info(resident_qr_credentials)").all() as any[];
    if (!qrCols.some((c: any) => c.name === 'token_ciphertext')) {
      db.exec('ALTER TABLE resident_qr_credentials ADD COLUMN token_ciphertext TEXT');
    }
  } catch { /* ignore */ }

  try {
    db.exec(`CREATE TABLE IF NOT EXISTS photo_display_consents (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL DEFAULT 'QR_VERIFICATION_DISPLAY' CHECK (purpose = 'QR_VERIFICATION_DISPLAY'),
  decision TEXT NOT NULL CHECK (decision IN ('GRANTED','DECLINED','WITHDRAWN')),
  decided_by TEXT NOT NULL CHECK (decided_by IN ('RESIDENT','MANAGER')),
  decided_by_admin_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_photo_display_consents_student ON photo_display_consents(student_id, created_at)`);
  } catch { /* table already exists */ }

  // Durable WhatsApp inbound inbox for existing development databases.
  // Additive only: no existing table or row is modified.
  db.exec(`CREATE TABLE IF NOT EXISTS whatsapp_inbound_inbox (
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
)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_wa_inbox_status ON whatsapp_inbound_inbox(status, next_attempt_at, created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_wa_inbox_message ON whatsapp_inbound_inbox(message_id)`);

  // Durable archive for losing WhatsApp conversation rows. Additive only:
  // no existing table or row is modified.
  db.exec(`CREATE TABLE IF NOT EXISTS whatsapp_conversation_archives (
  id TEXT PRIMARY KEY,
  archived_conversation_id TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  current_state TEXT NOT NULL,
  state_payload TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_wa_conv_archives_phone ON whatsapp_conversation_archives(phone_number, created_at)`);

  const accessLogColumns = db.prepare("PRAGMA table_info(access_logs)").all() as any[];
  if (!accessLogColumns.some(column => column.name === 'resident_qr_credential_id')) {
    db.exec('ALTER TABLE access_logs ADD COLUMN resident_qr_credential_id TEXT REFERENCES resident_qr_credentials(id) ON DELETE SET NULL');
  }
  if (!accessLogColumns.some(column => column.name === 'verification_channel')) {
    db.exec("ALTER TABLE access_logs ADD COLUMN verification_channel TEXT NOT NULL DEFAULT 'MANAGER'");
  }
  if (!accessLogColumns.some(column => column.name === 'staff_role')) {
    db.exec("ALTER TABLE access_logs ADD COLUMN staff_role TEXT NOT NULL DEFAULT 'MANAGER' CHECK (staff_role IN ('MANAGER', 'SECURITY'))");
  }
  if (!accessLogColumns.some(column => column.name === 'credential_fingerprint')) {
    db.exec('ALTER TABLE access_logs ADD COLUMN credential_fingerprint TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_access_logs_credential ON access_logs(resident_qr_credential_id, logged_at)');

  // Role-based access: existing administrator accounts keep full MANAGER
  // privileges; SECURITY accounts are created explicitly by a manager.
  const adminColumns = db.prepare("PRAGMA table_info(admin_users)").all() as any[];
  if (!adminColumns.some(column => column.name === 'role')) {
    db.exec("ALTER TABLE admin_users ADD COLUMN role TEXT NOT NULL DEFAULT 'MANAGER' CHECK (role IN ('MANAGER', 'SECURITY'))");
  }
  if (!adminColumns.some(column => column.name === 'is_active')) {
    db.exec('ALTER TABLE admin_users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))');
  }
  if (!adminColumns.some(column => column.name === 'must_change_password')) {
    db.exec('ALTER TABLE admin_users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1))');
    // One-time backfill, runs only when the column is first added:
    // pre-existing SECURITY accounts may still hold an unexpired temporary
    // password, so they must change it on next login. MANAGER rows and any
    // account created afterwards are deliberately untouched here.
    db.exec("UPDATE admin_users SET must_change_password = 1 WHERE role = 'SECURITY'");
  }

  // Preserve already-uploaded photographs when upgrading from the first photo
  // upload milestone into the review-history model.
  db.exec(`
    INSERT OR IGNORE INTO student_photo_submissions (id, student_id, storage_key, mime_type, status, submitted_at)
    SELECT 'legacy-photo-' || id, id, photo_storage_key,
      CASE
        WHEN photo_storage_key LIKE '%.png' THEN 'image/png'
        WHEN photo_storage_key LIKE '%.webp' THEN 'image/webp'
        ELSE 'image/jpeg'
      END,
      CASE WHEN photo_status IN ('APPROVED', 'REJECTED') THEN photo_status ELSE 'PENDING_REVIEW' END,
      updated_at
    FROM students
    WHERE photo_storage_key IS NOT NULL
  `);
}

export function resetDb() {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  const tables = db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `).all() as any[];
  for (const t of tables) {
    db.prepare(`DROP TABLE IF EXISTS "${t.name}"`).run();
  }
  db.pragma('foreign_keys = ON');
  initSchema(db);
}

export function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
