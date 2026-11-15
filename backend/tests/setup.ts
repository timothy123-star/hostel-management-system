import fs from 'fs';
import { afterAll, beforeAll } from 'vitest';
import { closeDb } from '../src/db/connection.js';
import { WhatsAppService } from '../src/services/whatsapp/whatsappService.js';

const testDbPath = process.env.DATABASE_FILE!;
const testPhotoDir = process.env.PHOTO_STORAGE_DIR!;

function removeTestDatabase() {
  closeDb();
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    fs.rmSync(`${testDbPath}${suffix}`, { force: true });
  }
  fs.rmSync(testPhotoDir, { recursive: true, force: true });
}

beforeAll(() => {
  removeTestDatabase();
  WhatsAppService.setForceSimulator(true);
});

afterAll(() => {
  removeTestDatabase();
});
