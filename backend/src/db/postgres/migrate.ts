import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Pool, PoolClient } from 'pg';

export interface PostgresMigration { id: string; sql: string; checksum?: string; }

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function checksum(sql: string): string {
  return crypto.createHash('sha256').update(sql).digest('hex');
}

export async function loadPostgresMigrations(migrationsDirectory = path.join(__dirname, 'migrations')): Promise<PostgresMigration[]> {
  const files = (await fs.readdir(migrationsDirectory)).filter(file => /^\d+_.+\.sql$/.test(file)).sort();
  return Promise.all(files.map(async file => ({
    id: file,
    sql: await fs.readFile(path.join(migrationsDirectory, file), 'utf8')
  })));
}

/** Applies additive, immutable migrations only. It never drops user data. */
export async function applyPostgresMigrations(pool: Pool, migrations: PostgresMigration[]): Promise<void> {
  const seen = new Set<string>();
  for (const migration of migrations) {
    if (!migration.id || !migration.sql.trim() || seen.has(migration.id)) throw new Error(`Invalid or duplicate PostgreSQL migration: ${migration.id || '(missing id)'}`);
    seen.add(migration.id);
  }

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(842519031)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const applied = await client.query<{ id: string; checksum: string }>('SELECT id, checksum FROM schema_migrations');
    const existing = new Map(applied.rows.map(row => [row.id, row.checksum]));

    for (const migration of migrations) {
      const digest = migration.checksum ?? checksum(migration.sql);
      const previous = existing.get(migration.id);
      if (previous && previous !== digest) throw new Error(`Refusing migration ${migration.id}: its previously applied checksum differs.`);
      if (previous) continue;

      await applyOne(client, migration.id, migration.sql, digest);
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(842519031)');
    } finally {
      client.release();
    }
  }
}

async function applyOne(client: PoolClient, id: string, sql: string, digest: string): Promise<void> {
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)', [id, digest]);
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve migration failure */ }
    throw error;
  }
}
