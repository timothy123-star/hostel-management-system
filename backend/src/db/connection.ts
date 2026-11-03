import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dbInstance: Database.Database | null = null;

export function getDb(customPath?: string): Database.Database {
  if (!dbInstance || customPath) {
    const resolvedPath = customPath || path.resolve(config.dbPath);
    const db = new Database(resolvedPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    if (!customPath) {
      dbInstance = db;
    } else {
      return db;
    }
  }
  return dbInstance;
}

export function initSchema(db: Database.Database) {
  const schemaPath = path.resolve(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(sql);
}

export function resetDb() {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  const tables = db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `).all() as any[];
  for (const t of tables) {
    db.prepare(`DROP TABLE IF EXISTS "${t.name}"`).run();
  }
  db.pragma('foreign_keys = ON');
  initSchema(db);
}

export function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
