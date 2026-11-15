import { describe, expect, it } from 'vitest';
import { getPostgresConnectionOptions, withTransaction } from '../src/db/postgres/connection.js';

describe('PostgreSQL connection foundation', () => {
  it('validates a supplied PostgreSQL URL and conservative pool options without reading dotenv', () => {
    expect(getPostgresConnectionOptions({ DATABASE_URL: 'postgresql://user:pass@localhost:5432/hostelos' })).toMatchObject({ max: 5, ssl: false });
    expect(getPostgresConnectionOptions({ DATABASE_URL: 'postgresql://user:pass@ep-example.neon.tech/hostelos?sslmode=require', PGPOOL_MAX: '3' })).toMatchObject({ max: 3, ssl: { rejectUnauthorized: true } });
    expect(() => getPostgresConnectionOptions({ DATABASE_URL: 'https://example.test/not-postgres' })).toThrow(/postgres/i);
    expect(() => getPostgresConnectionOptions({ DATABASE_URL: 'postgres://localhost/db', PGPOOL_MAX: '0' })).toThrow(/PGPOOL_MAX/);
  });

  it('commits successful work and rolls back rejected work while releasing the client', async () => {
    const calls: string[] = [];
    const client = { query: async (text: string) => { calls.push(text); }, release: () => calls.push('RELEASE') };
    const pool = { connect: async () => client } as any;
    await expect(withTransaction(pool, async () => 'done')).resolves.toBe('done');
    expect(calls).toEqual(['BEGIN', 'COMMIT', 'RELEASE']);

    calls.length = 0;
    await expect(withTransaction(pool, async () => { throw new Error('failure'); })).rejects.toThrow('failure');
    expect(calls).toEqual(['BEGIN', 'ROLLBACK', 'RELEASE']);
  });
});
