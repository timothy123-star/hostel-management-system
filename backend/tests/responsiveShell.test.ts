import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

// Source-level responsive contract (no browser available in this environment):
// asserts the mobile shell patterns exist in the frontend source so a future
// visual pass only needs to confirm rendering, not re-discover structure.
const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'src');

function src(...parts: string[]) {
  return fs.readFileSync(path.join(frontendRoot, ...parts), 'utf8');
}

describe('responsive manager shell (source-level)', () => {
  it('sidebar collapses into a drawer below md with overlay and close action', () => {
    const sidebar = src('components', 'Sidebar.tsx');
    expect(sidebar).toContain('-translate-x-full');
    expect(sidebar).toContain('md:translate-x-0');
    expect(sidebar).toContain('md:hidden');
    expect(sidebar).toContain('max-w-[85vw]');
    expect(sidebar).toContain('onCloseMobile');
    expect(sidebar).toContain('aria-label="Close navigation"');
  });

  it('layout exposes a hamburger on phones and uses responsive padding', () => {
    const layout = src('components', 'Layout.tsx');
    expect(layout).toContain('aria-label="Open navigation"');
    expect(layout).toContain('md:hidden');
    expect(layout).toContain('p-4 md:p-8');
    expect(layout).toContain('px-4 md:px-8');
    expect(layout).toContain('min-w-0');
  });

  it('main content cannot force page-level horizontal overflow', () => {
    expect(src('components', 'Layout.tsx')).toContain('overflow-x-hidden');
    const css = src('index.css');
    expect(css).toContain('overflow-x');
  });

  it('inputs stay readable on phones without iOS auto-zoom', () => {
    const css = src('index.css');
    expect(css).toMatch(/max-width:\s*767px/);
    expect(css).toContain('font-size: 16px');
  });

  it('dialogs fit phone viewports with internal scrolling', () => {
    const modal = src('components', 'Modal.tsx');
    expect(modal).toContain('max-h-[92dvh]');
    expect(modal).toContain('p-4 sm:p-6');
    expect(modal).toContain('overflow-y-auto');
  });

  it('simulator phone frame scales with small viewports', () => {
    const sim = src('pages', 'WhatsAppSimulatorPage.tsx');
    expect(sim).not.toContain('h-[640px]');
    expect(sim).toMatch(/72dvh|min-h-\[420px\]/);
  });

  it('scanner and security actions use touch-friendly targets', () => {
    const scanner = src('pages', 'SecurityScannerPage.tsx');
    expect(scanner).toContain('min-h-[48px]');
    expect(scanner).toContain('min-h-[52px]');
    expect(scanner).not.toMatch(/className="px-2 py-1 /);
  });

  it('SECURITY staff never render the manager navigation shell', () => {
    const app = src('App.tsx');
    expect(app).toContain('/security/scan');
    expect(app).toContain('SecurityScannerPage');
    expect(app).toContain('SecurityAccountsPage');
    // Scanner-only branch returns before Layout for non-managers.
    expect(app).toMatch(/if \(!isManager\)[\s\S]*return <SecurityScannerPage \/>/);
  });

  it('QR deep links preserve the token across the staff sign-in redirect', () => {
    expect(src('pages', 'ResidentVerificationPage.tsx')).toContain('hostel_pending_scan');
    expect(src('pages', 'LoginPage.tsx')).toContain('hostel_pending_scan');
    expect(src('pages', 'LoginPage.tsx')).toContain('/security/scan');
  });
});
