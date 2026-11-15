import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateProductionConfig } from '../src/config.js';
import { getDb, initSchema } from '../src/db/connection.js';
import { assertDemoSeedingAllowed, runSeed } from '../src/db/seed.js';
import { bootstrapInitialManager } from '../src/services/initialAdminService.js';

const createdDatabases: { file: string; db: ReturnType<typeof getDb> }[] = [];

function productionEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    JWT_SECRET: 'a-production-jwt-secret-that-is-longer-than-thirty-two-characters',
    ADMIN_USERNAME: 'hostel-manager',
    ADMIN_PASSWORD: 'a-long-initial-manager-password',
    ...overrides
  };
}

function temporaryDatabase() {
  const file = path.join(os.tmpdir(), `hostelos-production-readiness-${crypto.randomUUID()}.sqlite`);
  const db = getDb(file);
  createdDatabases.push({ file, db });
  initSchema(db);
  return db;
}

afterEach(() => {
  for (const { file, db } of createdDatabases.splice(0)) {
    db.close();
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}-wal`, { force: true });
    fs.rmSync(`${file}-shm`, { force: true });
  }
});

describe('production readiness configuration and bootstrap', () => {
  it('preserves development behavior while rejecting invalid production credentials', () => {
    expect(() => validateProductionConfig({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => validateProductionConfig(productionEnv({ JWT_SECRET: undefined }))).toThrow(/requires JWT_SECRET/i);
    expect(() => validateProductionConfig(productionEnv({ JWT_SECRET: 'short' }))).toThrow(/at least 32/i);
    expect(() => validateProductionConfig(productionEnv({ JWT_SECRET: 'fallback-demo-secret-key-min-32-chars-long!' }))).toThrow(/known demo/i);
    expect(() => validateProductionConfig(productionEnv({ ADMIN_USERNAME: undefined, ADMIN_PASSWORD: undefined }))).toThrow(/ADMIN_USERNAME/i);
    expect(() => validateProductionConfig(productionEnv({ ADMIN_PASSWORD: 'short' }))).toThrow(/at least 16/i);
    expect(() => validateProductionConfig(productionEnv({ ADMIN_PASSWORD: 'AdminPassword123!' }))).toThrow(/known demo/i);
  });

  it('creates one hashed initial manager without demo records and never overwrites it', async () => {
    const db = temporaryDatabase();
    const manager = {
      adminUsername: 'hostel-manager',
      adminPassword: 'a-long-initial-manager-password',
      adminFullName: 'Hostel Operations Manager',
      adminEmail: 'manager@example.test'
    };

    const first = await bootstrapInitialManager(db, manager);
    expect(first.created).toBe(true);
    expect(first.id).toMatch(/^admin-/);
    expect(first.id).not.toBe('admin-root-01');

    const stored = db.prepare('SELECT * FROM admin_users').get() as any;
    expect(await bcrypt.compare(manager.adminPassword, stored.password_hash)).toBe(true);
    expect(stored.password_hash).not.toBe(manager.adminPassword);
    expect(db.prepare('SELECT COUNT(*) as count FROM hostels').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) as count FROM students').get()).toEqual({ count: 0 });

    const originalHash = stored.password_hash;
    const second = await bootstrapInitialManager(db, { ...manager, adminPassword: 'a-different-long-manager-password' });
    expect(second.created).toBe(false);
    expect((db.prepare('SELECT * FROM admin_users').get() as any).password_hash).toBe(originalHash);
    expect(db.prepare('SELECT COUNT(*) as count FROM admin_users').get()).toEqual({ count: 1 });
  });

  it('rejects production seeding before any reset or demo mutation', async () => {
    const db = getDb();
    initSchema(db);
    const before = db.prepare('SELECT COUNT(*) as count FROM hostels').get();
    expect(() => assertDemoSeedingAllowed('production')).toThrow(/disabled in production/i);
    await expect(runSeed(true, 'production')).rejects.toThrow(/disabled in production/i);
    expect(db.prepare('SELECT COUNT(*) as count FROM hostels').get()).toEqual(before);
  });
});
