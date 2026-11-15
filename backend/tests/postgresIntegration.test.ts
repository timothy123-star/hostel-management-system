import crypto from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { applyPostgresMigrations, loadPostgresMigrations } from '../src/db/postgres/migrate.js';
import { APPLICATION_TABLES } from '../src/db/postgres/migrateSqliteData.js';

const integrationUrl = process.env.PG_INTEGRATION_TEST_DATABASE_URL?.trim();

export function assertSafeIntegrationUrl(connectionString: string): URL {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Integration URL must use PostgreSQL.');
  const host = url.hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('Integration tests only permit a local PostgreSQL host.');
  const databaseName = url.pathname.replace(/^\//, '').toLowerCase();
  if (!/(hostelos.*test|test.*hostelos)/.test(databaseName)) throw new Error('Integration database name must clearly identify a HostelOS test database.');
  return url;
}

const integration = integrationUrl ? describe : describe.skip;
integration('isolated PostgreSQL integration rehearsal', () => {
  let pool: Pool;
  let schema: string;

  beforeAll(async () => {
    const url = assertSafeIntegrationUrl(integrationUrl!);
    schema = `hostelos_integration_${crypto.randomUUID().replace(/-/g, '')}`;
    // This generated schema is the only destructive cleanup target.
    pool = new Pool({ connectionString: url.toString(), max: 1 });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`SET search_path TO "${schema}"`);
    await applyPostgresMigrations(pool, await loadPostgresMigrations());
  });

  afterAll(async () => {
    if (!pool) return;
    try { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await pool.end(); }
  });

  it('applies all 24 tables and records the immutable initial migration', async () => {
    const tables = await pool.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name");
    expect(tables.rows.filter(row => row.table_name !== 'schema_migrations').map(row => row.table_name).sort()).toEqual([...APPLICATION_TABLES].sort());
    expect(await pool.query("SELECT id FROM schema_migrations WHERE id = '0001_initial_schema.sql'")).toMatchObject({ rowCount: 1 });
  });

  it('is safe to rerun and rejects a changed applied checksum', async () => {
    const migrations = await loadPostgresMigrations();
    await expect(applyPostgresMigrations(pool, migrations)).resolves.toBeUndefined();
    await expect(applyPostgresMigrations(pool, [{ id: '0001_initial_schema.sql', sql: 'SELECT 1;' }])).rejects.toThrow(/checksum differs/);
  });
});

describe('PostgreSQL integration environment safety', () => {
  it('refuses remote and ambiguously named targets before a connection is made', () => {
    expect(() => assertSafeIntegrationUrl('postgresql://u:p@example.com/hostelos_test')).toThrow(/local/i);
    expect(() => assertSafeIntegrationUrl('postgresql://u:p@localhost/postgres')).toThrow(/test database/i);
  });
});
