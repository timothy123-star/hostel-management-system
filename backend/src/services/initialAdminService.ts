import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import type Database from 'better-sqlite3';
import type { Pool } from 'pg';
import { config } from '../config.js';
import { withTransaction } from '../db/postgres/connection.js';

type InitialAdminConfig = Pick<typeof config, 'adminUsername' | 'adminPassword' | 'adminFullName' | 'adminEmail'>;

/**
 * Creates the single initial manager only for an empty administrator table.
 * Existing accounts are deliberately never modified by startup.
 */
export async function bootstrapInitialManager(
  db: Database.Database,
  adminConfig: InitialAdminConfig = config
): Promise<{ created: boolean; id?: string }> {
  const existing = db.prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string } | undefined;
  if (existing) return { created: false, id: existing.id };

  const passwordHash = await bcrypt.hash(adminConfig.adminPassword, 12);
  const id = `admin-${crypto.randomUUID()}`;
  const createIfEmpty = db.transaction(() => {
    const concurrentManager = db.prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string } | undefined;
    if (concurrentManager) return { created: false, id: concurrentManager.id };

    db.prepare(`
      INSERT INTO admin_users (id, username, password_hash, full_name, email, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(id, adminConfig.adminUsername, passwordHash, adminConfig.adminFullName, adminConfig.adminEmail);
    return { created: true, id };
  });

  return createIfEmpty();
}

/**
 * PostgreSQL equivalent of the SQLite bootstrap. The transaction-scoped
 * advisory lock protects the empty-table case, where a row lock alone cannot
 * prevent two new application instances from both observing no managers.
 */
export async function bootstrapInitialManagerPostgres(
  pool: Pool,
  adminConfig: InitialAdminConfig = config
): Promise<{ created: boolean; id?: string }> {
  const id = `admin-${crypto.randomUUID()}`;

  return withTransaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [842519032]);
    const existing = await client.query<{ id: string }>('SELECT id FROM admin_users LIMIT 1 FOR UPDATE');
    if (existing.rows[0]) return { created: false, id: existing.rows[0].id };

    const passwordHash = await bcrypt.hash(adminConfig.adminPassword, 12);
    await client.query(`
      INSERT INTO admin_users (id, username, password_hash, full_name, email, created_at)
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
    `, [id, adminConfig.adminUsername, passwordHash, adminConfig.adminFullName, adminConfig.adminEmail]);
    return { created: true, id };
  });
}
