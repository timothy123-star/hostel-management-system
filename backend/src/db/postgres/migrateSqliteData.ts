import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { Pool, PoolClient } from 'pg';
import { closePostgresPool, createPostgresPool, type PostgresEnvironment } from './connection.js';

export const APPLICATION_TABLES = [
  'admin_users', 'hostels', 'rooms', 'students', 'student_photo_submissions', 'student_photo_requests',
  'student_photo_upload_links', 'booking_groups', 'booking_group_members', 'matching_queue', 'payments',
  'demo_bank_transactions', 'room_allocations', 'qr_credentials', 'resident_qr_credentials', 'access_logs',
  'announcements', 'announcement_recipients', 'notification_preferences', 'notification_logs', 'audit_logs',
  'whatsapp_conversations', 'whatsapp_processed_messages', 'whatsapp_photo_disclosures'
] as const;
export type ApplicationTable = typeof APPLICATION_TABLES[number];

const BOOLEAN_COLUMNS = new Set(['consent_random_matching', 'auto_complete_triple_consent', 'is_matched_from_queue', 'whatsapp_enabled', 'renewal_reminders_enabled', 'announcements_enabled']);
const JSON_COLUMNS = new Set(['state_payload', 'payload', 'old_values', 'new_values']);
const DATE_COLUMNS = new Set(['accommodation_start_date', 'accommodation_end_date']);
const TIMESTAMP_COLUMNS = new Set(['transaction_timestamp']);
const INITIAL_SCHEMA_MIGRATION = '0001_initial_schema.sql';
const REQUIRED_SOURCE_COLUMNS: Record<ApplicationTable, readonly string[]> = {
  admin_users: ['id', 'username', 'password_hash', 'created_at'], hostels: ['id', 'code', 'created_at'],
  rooms: ['id', 'hostel_id', 'price_per_student', 'created_at'], students: ['id', 'phone_number', 'gender', 'consent_random_matching', 'created_at'],
  student_photo_submissions: ['id', 'student_id', 'storage_key', 'submitted_at'], student_photo_requests: ['id', 'student_id', 'status', 'requested_at'],
  student_photo_upload_links: ['id', 'student_id', 'token_hash', 'created_at'], booking_groups: ['id', 'hostel_id', 'created_by_student_id', 'created_at'],
  booking_group_members: ['id', 'group_id', 'student_id', 'joined_at'], matching_queue: ['id', 'student_id', 'hostel_id', 'queued_at'],
  payments: ['id', 'student_id', 'booking_group_id', 'amount', 'created_at'], demo_bank_transactions: ['id', 'linked_payment_id', 'amount', 'transaction_timestamp', 'created_at'],
  room_allocations: ['id', 'room_id', 'student_id', 'booking_group_id', 'accommodation_start_date', 'accommodation_end_date', 'created_at'],
  qr_credentials: ['id', 'student_id', 'room_allocation_id', 'token_hash', 'issued_at'], resident_qr_credentials: ['id', 'student_id', 'issued_for_allocation_id', 'token_hash', 'issued_at'],
  access_logs: ['id', 'logged_at'], announcements: ['id', 'created_at'], announcement_recipients: ['id', 'announcement_id', 'student_id', 'sent_at'],
  notification_preferences: ['id', 'student_id', 'updated_at'], notification_logs: ['id', 'student_id', 'sent_at'],
  audit_logs: ['id', 'action', 'created_at'], whatsapp_conversations: ['id', 'phone_number', 'state_payload', 'created_at'],
  whatsapp_processed_messages: ['id', 'message_id', 'processed_at'],
  whatsapp_photo_disclosures: ['phone_number', 'student_id', 'disclosure_version', 'shown_at', 'created_at']
};

export interface MigrationOptions {
  sourcePath: string;
  destinationUrl?: string;
  execute?: boolean;
  allowSynthetic?: boolean;
  postgresEnvironment?: PostgresEnvironment;
  pool?: Pool;
}
export interface TableReport { table: ApplicationTable; sourceRows: number; insertedRows: number; destinationRows: number; result: 'PENDING' | 'DRY_RUN' | 'IMPORTED'; }
export interface MigrationReport { dryRun: boolean; syntheticReasons: string[]; foreignKeyIntegrity: 'PASS'; tables: TableReport[]; outcome: 'DRY_RUN' | 'COMMITTED'; }

export function parseMigrationArgs(args: string[]): Pick<MigrationOptions, 'sourcePath' | 'execute' | 'allowSynthetic'> {
  let sourcePath: string | undefined;
  let execute = false;
  let allowSynthetic = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--source') sourcePath = args[++index];
    else if (arg === '--execute') execute = true;
    else if (arg === '--allow-synthetic') allowSynthetic = true;
    else throw new Error(`Unknown migration option: ${arg}`);
  }
  if (!sourcePath) throw new Error('An explicit SQLite source path is required: --source <file>.');
  return { sourcePath, execute, allowSynthetic };
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) throw new Error(`Unsafe database identifier: ${identifier}`);
  return `"${identifier}"`;
}

export function openReadOnlySqlite(sourcePath: string): Database.Database {
  const resolved = path.resolve(sourcePath);
  if (!fs.existsSync(resolved)) throw new Error('SQLite source file does not exist.');
  return new Database(resolved, { readonly: true, fileMustExist: true });
}

function timestampValue(value: unknown, table: string, column: string, id: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/i.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid or timezone-ambiguous timestamp in ${table}.${column} for record ${String(id ?? '(unknown)')}.`);
  }
  return value;
}
function dateValue(value: unknown, table: string, column: string, id: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`Invalid date in ${table}.${column} for record ${String(id ?? '(unknown)')}.`);
  }
  return value;
}

/** Converts only documented SQLite-to-PostgreSQL types and rejects uncertainty. */
export function transformRow(table: ApplicationTable, row: Record<string, unknown>): Record<string, unknown> {
  const converted: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    if (BOOLEAN_COLUMNS.has(column)) {
      if (value !== 0 && value !== 1 && value !== false && value !== true) throw new Error(`Invalid SQLite boolean in ${table}.${column} for record ${String(row.id ?? '(unknown)')}.`);
      converted[column] = value === 1 || value === true;
    } else if (DATE_COLUMNS.has(column)) {
      converted[column] = dateValue(value, table, column, row.id);
    } else if (column.endsWith('_at') || TIMESTAMP_COLUMNS.has(column)) {
      converted[column] = timestampValue(value, table, column, row.id);
    } else if (JSON_COLUMNS.has(column) && value !== null && value !== undefined) {
      if (typeof value !== 'string') throw new Error(`Invalid JSON in ${table}.${column} for record ${String(row.id ?? '(unknown)')}.`);
      try { JSON.parse(value); } catch { throw new Error(`Malformed JSON in ${table}.${column} for record ${String(row.id ?? '(unknown)')}.`); }
      converted[column] = value;
    } else if (column === 'amount' || column === 'price_per_student') {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid monetary amount in ${table}.${column} for record ${String(row.id ?? '(unknown)')}.`);
      converted[column] = value.toString();
    } else converted[column] = value;
  }
  return converted;
}

function sourceColumns(db: Database.Database, table: ApplicationTable): string[] {
  const columns = db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string }>;
  const names = columns.map(column => column.name);
  const missing = REQUIRED_SOURCE_COLUMNS[table].filter(column => !names.includes(column));
  if (!columns.length || missing.length) throw new Error(`SQLite source schema is missing compatible ${table} column(s): ${missing.join(', ') || 'unknown'}.`);
  return names;
}

function syntheticReasons(db: Database.Database): string[] {
  const reasons: string[] = [];
  const sourceName = path.basename((db as any).name ?? '').toLowerCase();
  if (/(vitest|test|fixture)/.test(sourceName)) reasons.push('source filename indicates a test fixture');
  const demoStudents = db.prepare("SELECT COUNT(*) AS count FROM students WHERE id LIKE 'stu-demo-%'").get() as { count: number };
  if (demoStudents.count > 0) reasons.push('student IDs match known synthetic demo identifiers');
  const seededAudit = db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'SEED_INITIALIZE'").get() as { count: number };
  if (seededAudit.count > 0) reasons.push('seed initialization audit record is present');
  return reasons;
}

export function preflightSqliteSource(sourcePath: string, allowSynthetic = false): { db: Database.Database; reports: TableReport[]; syntheticReasons: string[] } {
  const db = openReadOnlySqlite(sourcePath);
  try {
    const fkProblems = db.pragma('foreign_key_check') as Array<Record<string, unknown>>;
    if (fkProblems.length) throw new Error(`SQLite foreign-key integrity check failed (${fkProblems.length} violation(s)).`);
    const reports = APPLICATION_TABLES.map(table => {
      const columns = sourceColumns(db, table);
      const rows = db.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all() as Record<string, unknown>[];
      for (const row of rows) transformRow(table, row);
      return { table, sourceRows: rows.length, insertedRows: 0, destinationRows: 0, result: 'PENDING' as const, columns };
    });
    const synthetic = syntheticReasons(db);
    if (synthetic.length && !allowSynthetic) throw new Error(`Refusing likely synthetic/test SQLite data: ${synthetic.join('; ')}. Re-run only when intentional with --allow-synthetic.`);
    return { db, reports: reports.map(({ columns: _columns, ...report }) => report), syntheticReasons: synthetic };
  } catch (error) {
    db.close();
    throw error;
  }
}

async function validateDestination(client: PoolClient, source: Database.Database): Promise<void> {
  const migration = await client.query<{ id: string }>('SELECT id FROM schema_migrations WHERE id = $1', [INITIAL_SCHEMA_MIGRATION]);
  if (!migration.rowCount) throw new Error('PostgreSQL destination is not initialized with the HostelOS initial schema migration.');
  for (const table of APPLICATION_TABLES) {
    const destinationColumns = await client.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1", [table]);
    const existing = new Set(destinationColumns.rows.map(row => row.column_name));
    for (const column of sourceColumns(source, table)) if (!existing.has(column)) throw new Error(`PostgreSQL destination is missing expected ${table}.${column}.`);
    const count = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${quoteIdentifier(table)}`);
    if (count.rows[0]?.count !== '0') throw new Error(`PostgreSQL destination table ${table} is not empty; refusing to overwrite data.`);
  }
}

async function importAll(client: PoolClient, source: Database.Database, reports: TableReport[]): Promise<void> {
  for (const report of reports) {
    const columns = sourceColumns(source, report.table);
    const rows = source.prepare(`SELECT * FROM ${quoteIdentifier(report.table)}`).all() as Record<string, unknown>[];
    const insert = `INSERT INTO ${quoteIdentifier(report.table)} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})`;
    for (const row of rows) await client.query(insert, columns.map(column => transformRow(report.table, row)[column]));
    const destination = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${quoteIdentifier(report.table)}`);
    if (destination.rows[0]?.count !== String(rows.length)) throw new Error(`Post-import count mismatch for ${report.table}.`);
    report.insertedRows = rows.length;
    report.destinationRows = rows.length;
    report.result = 'IMPORTED';
  }
}

export async function migrateSqliteData(options: MigrationOptions): Promise<MigrationReport> {
  const preflight = preflightSqliteSource(options.sourcePath, options.allowSynthetic);
  const { db, reports, syntheticReasons } = preflight;
  try {
    if (!options.execute) return { dryRun: true, syntheticReasons, foreignKeyIntegrity: 'PASS', tables: reports.map(report => ({ ...report, result: 'DRY_RUN' })), outcome: 'DRY_RUN' };
    if (!options.destinationUrl) throw new Error('PG_MIGRATION_DATABASE_URL is required with --execute.');
    const pool = options.pool ?? createPostgresPool({ ...options.postgresEnvironment, DATABASE_URL: options.destinationUrl });
    try {
      const client = await pool.connect();
      try {
        await validateDestination(client, db);
        await client.query('BEGIN');
        try { await importAll(client, db, reports); await client.query('COMMIT'); }
        catch (error) { try { await client.query('ROLLBACK'); } catch { /* preserve the import failure */ } throw error; }
      } finally { client.release(); }
    } finally { if (!options.pool) await closePostgresPool(pool); }
    return { dryRun: false, syntheticReasons, foreignKeyIntegrity: 'PASS', tables: reports, outcome: 'COMMITTED' };
  } finally { db.close(); }
}

function printReport(report: MigrationReport): void {
  console.log('Table | Source rows | Inserted rows | Destination rows | Result');
  for (const row of report.tables) console.log(`${row.table} | ${row.sourceRows} | ${row.insertedRows} | ${row.destinationRows} | ${row.result}`);
  console.log(`Foreign-key integrity: ${report.foreignKeyIntegrity}; outcome: ${report.outcome}`);
}

if (process.argv[1]?.endsWith('migrateSqliteData.ts') || process.argv[1]?.endsWith('migrateSqliteData.js')) {
  const args = parseMigrationArgs(process.argv.slice(2));
  const destinationUrl = process.env.PG_MIGRATION_DATABASE_URL?.trim();
  if (!destinationUrl) throw new Error('PG_MIGRATION_DATABASE_URL must be explicitly set; DATABASE_URL is intentionally ignored.');
  migrateSqliteData({ ...args, destinationUrl }).then(printReport).catch(error => {
    console.error(error instanceof Error ? error.message : 'SQLite-to-PostgreSQL migration failed.');
    process.exitCode = 1;
  });
}
