// Copies non-TypeScript runtime assets that `tsc` does not emit into
// `backend/dist`. Runs automatically via the backend `postbuild` hook, so
// every production build (`npm run build`) packages these files.
// Production boot reads `dist/db/schema.sql` (see src/db/connection.ts);
// the Postgres migration path reads `dist/db/postgres/migrations/*.sql`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const copied = [];

function copyFile(relativeSrc, relativeDest) {
  const src = path.join(backendRoot, relativeSrc);
  const dest = path.join(backendRoot, relativeDest);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  copied.push(relativeDest);
}

// SQLite schema required for first-start initialization.
copyFile(path.join('src', 'db', 'schema.sql'), path.join('dist', 'db', 'schema.sql'));

// Versioned Postgres migrations loaded via readdir at runtime.
const migrationsDir = path.join(backendRoot, 'src', 'db', 'postgres', 'migrations');
for (const file of fs.readdirSync(migrationsDir)) {
  if (!/^\d+_.+\.sql$/.test(file)) continue;
  copyFile(
    path.join('src', 'db', 'postgres', 'migrations', file),
    path.join('dist', 'db', 'postgres', 'migrations', file)
  );
}

console.log(`runtime assets copied: ${copied.join(', ')}`);
