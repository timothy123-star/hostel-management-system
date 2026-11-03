import { defineConfig } from 'vitest/config';
import path from 'path';
import os from 'os';

// This is set before application modules are imported. dotenv does not override
// an existing environment variable, so tests can never open the development DB.
process.env.DATABASE_FILE = path.join(os.tmpdir(), `hostelos-vitest-${process.pid}.sqlite`);

export default defineConfig({
  test: {
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true
      }
    },
    setupFiles: ['./tests/setup.ts']
  }
});
