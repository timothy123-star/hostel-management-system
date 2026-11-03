import { getDb, initSchema } from './connection.js';

export function runInit() {
  console.log('Initializing database schema...');
  const db = getDb();
  initSchema(db);
  console.log('Database schema successfully initialized.');
}

if (process.argv[1]?.endsWith('init.ts') || process.argv[1]?.endsWith('init.js')) {
  runInit();
}
