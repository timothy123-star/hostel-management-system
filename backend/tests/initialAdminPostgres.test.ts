import { describe, expect, it } from 'vitest';
import { bootstrapInitialManagerPostgres } from '../src/services/initialAdminService.js';

const managerConfig = {
  adminUsername: 'staging-manager',
  adminPassword: 'a-long-unique-staging-password',
  adminFullName: 'Staging Manager',
  adminEmail: 'manager@example.test'
};

function fakePool(existingId?: string) {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const client = {
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      if (text.includes('SELECT id FROM admin_users')) return { rows: existingId ? [{ id: existingId }] : [] };
      return { rows: [] };
    },
    release: () => calls.push({ text: 'RELEASE' })
  };
  return { pool: { connect: async () => client } as any, calls };
}

describe('PostgreSQL initial manager bootstrap', () => {
  it('creates a bcrypt-hashed manager inside a locked transaction only when no manager exists', async () => {
    const { pool, calls } = fakePool();
    const result = await bootstrapInitialManagerPostgres(pool, managerConfig);

    expect(result.created).toBe(true);
    expect(calls.map(call => call.text)).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT', 'RELEASE']));
    expect(calls.some(call => call.text.includes('pg_advisory_xact_lock'))).toBe(true);
    const insert = calls.find(call => call.text.includes('INSERT INTO admin_users'));
    expect(insert?.text).toContain('$1');
    expect(insert?.values?.[2]).not.toBe(managerConfig.adminPassword);
    expect(String(insert?.values?.[2])).toMatch(/^\$2[aby]\$/);
  });

  it('preserves an existing manager without inserting another account', async () => {
    const { pool, calls } = fakePool('existing-manager');
    await expect(bootstrapInitialManagerPostgres(pool, managerConfig)).resolves.toEqual({ created: false, id: 'existing-manager' });
    expect(calls.some(call => call.text.includes('INSERT INTO admin_users'))).toBe(false);
  });
});
