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

  const accessLogColumns = db.prepare("PRAGMA table_info(access_logs)").all() as any[];
  if (!accessLogColumns.some(column => column.name === 'resident_qr_credential_id')) {
    db.exec('ALTER TABLE access_logs ADD COLUMN resident_qr_credential_id TEXT REFERENCES resident_qr_credentials(id) ON DELETE SET NULL');
  }
  if (!accessLogColumns.some(column => column.name === 'verification_channel')) {
    db.exec("ALTER TABLE access_logs ADD COLUMN verification_channel TEXT NOT NULL DEFAULT 'MANAGER'");
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
