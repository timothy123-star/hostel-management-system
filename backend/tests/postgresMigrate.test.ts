import { describe, expect, it } from 'vitest';
import { applyPostgresMigrations } from '../src/db/postgres/migrate.js';

function fakePool(existing: { id: string; checksum: string }[] = []) {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const client = {
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      if (text === 'SELECT id, checksum FROM schema_migrations') return { rows: existing };
      return { rows: [] };
    },
    release: () => calls.push({ text: 'RELEASE' })
  };
  return { pool: { connect: async () => client } as any, calls };
}

describe('PostgreSQL schema migrations', () => {
  it('tracks an additive migration transactionally', async () => {
    const { pool, calls } = fakePool();
    await applyPostgresMigrations(pool, [{ id: '0001_initial_schema.sql', sql: 'CREATE TABLE example (id TEXT PRIMARY KEY);' }]);
    expect(calls.map(call => call.text)).toContain('BEGIN');
    expect(calls.map(call => call.text)).toContain('COMMIT');
    expect(calls.find(call => call.text.startsWith('INSERT INTO schema_migrations'))?.values?.[0]).toBe('0001_initial_schema.sql');
    expect(calls.at(-1)?.text).toBe('RELEASE');
  });

  it('refuses changed content for an already applied migration', async () => {
    const { pool } = fakePool([{ id: '0001_initial_schema.sql', checksum: 'different-checksum' }]);
    await expect(applyPostgresMigrations(pool, [{ id: '0001_initial_schema.sql', sql: 'CREATE TABLE changed (id TEXT);' }])).rejects.toThrow(/checksum differs/);
  });

  it('refuses duplicate migration identifiers before changing the database', async () => {
    const { pool, calls } = fakePool();
    await expect(applyPostgresMigrations(pool, [
      { id: '0001_initial_schema.sql', sql: 'SELECT 1;' },
      { id: '0001_initial_schema.sql', sql: 'SELECT 2;' }
    ])).rejects.toThrow(/duplicate/i);
    expect(calls).toHaveLength(0);
  });
});
