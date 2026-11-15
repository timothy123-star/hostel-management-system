import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

// Regression test: `tsc` does not emit non-TypeScript files, so the backend
// `postbuild` hook must package every SQL asset the production runtime reads
// from `dist/` (Railway failed to boot with ENOENT on dist/db/schema.sql).
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(backendRoot, 'dist');

describe('built backend runtime assets', () => {
  it('packages dist/db/schema.sql identical to the source schema', () => {
    if (!fs.existsSync(distRoot)) return; // local test-only runs without a build
    const src = path.join(backendRoot, 'src', 'db', 'schema.sql');
    const dist = path.join(distRoot, 'db', 'schema.sql');
    expect(fs.existsSync(dist)).toBe(true);
    expect(fs.readFileSync(dist, 'utf8')).toBe(fs.readFileSync(src, 'utf8'));
  });

  it('packages every postgres migration SQL file into dist', () => {
    if (!fs.existsSync(distRoot)) return;
    const srcDir = path.join(backendRoot, 'src', 'db', 'postgres', 'migrations');
    const distDir = path.join(distRoot, 'db', 'postgres', 'migrations');
    const expected = fs.readdirSync(srcDir).filter(f => /^\d+_.+\.sql$/.test(f)).sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(fs.existsSync(distDir)).toBe(true);
    const actual = fs.readdirSync(distDir).filter(f => /^\d+_.+\.sql$/.test(f)).sort();
    expect(actual).toEqual(expected);
    for (const file of expected) {
      expect(fs.readFileSync(path.join(distDir, file), 'utf8'))
        .toBe(fs.readFileSync(path.join(srcDir, file), 'utf8'));
    }
  });
});
