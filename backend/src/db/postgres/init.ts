import { createPostgresPool, closePostgresPool } from './connection.js';
import { applyPostgresMigrations, loadPostgresMigrations } from './migrate.js';

/** Explicit-only entry point. Ordinary HostelOS startup continues to use SQLite. */
export async function runPostgresMigrations(): Promise<void> {
  const pool = createPostgresPool();
  try {
    await applyPostgresMigrations(pool, await loadPostgresMigrations());
    console.log('PostgreSQL schema migrations completed.');
  } finally {
    await closePostgresPool(pool);
  }
}

if (process.argv[1]?.endsWith('postgres/init.ts') || process.argv[1]?.endsWith('postgres/init.js')) {
  runPostgresMigrations().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
