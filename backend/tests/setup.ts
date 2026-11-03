import fs from 'fs';
import { afterAll, beforeAll } from 'vitest';
import { closeDb } from '../src/db/connection.js';

const testDbPath = process.env.DATABASE_FILE!;

function removeTestDatabase() {
  closeDb();
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    fs.rmSync(`${testDbPath}${suffix}`, { force: true });
  }
}

beforeAll(() => {
  removeTestDatabase();
});

afterAll(() => {
  removeTestDatabase();
});
