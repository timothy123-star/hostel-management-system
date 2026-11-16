import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { extractQrToken } from '@hostel/shared';

const TOKEN = 'AbC123_-xYz45678_AbC123_-xYz45678_AbC123456';
const PROD_URL = `https://hostelos-app-production.up.railway.app/resident-verification/${TOKEN}`;
const LOCAL_URL = `http://localhost:3000/resident-verification/${TOKEN}`;

const modalPath = path.resolve(__dirname, '../../frontend/src/components/QRScannerModal.tsx');
const securityPath = path.resolve(__dirname, '../../frontend/src/pages/SecurityScannerPage.tsx');
const modal = () => fs.readFileSync(modalPath, 'utf8');

describe('extractQrToken credential parsing', () => {
  it('passes a raw opaque token through unchanged', () => {
    expect(extractQrToken(TOKEN)).toBe(TOKEN);
  });

  it('extracts the token from generated resident-verification URLs', () => {
    expect(extractQrToken(PROD_URL)).toBe(TOKEN);
    expect(extractQrToken(LOCAL_URL)).toBe(TOKEN);
  });

  it('tolerates trailing slashes, query strings, fragments and whitespace', () => {
    expect(extractQrToken(`${PROD_URL}/`)).toBe(TOKEN);
    expect(extractQrToken(`  ${PROD_URL}?x=1  `)).toBe(TOKEN);
    expect(extractQrToken(`${LOCAL_URL}#scan`)).toBe(TOKEN);
    expect(extractQrToken(`${PROD_URL}/?next=/dashboard#top`)).toBe(TOKEN);
  });

  it('rejects unrelated QR payloads and malformed input', () => {
    expect(extractQrToken('https://example.com/some-page')).toBeNull();
    expect(extractQrToken('https://hostelos-app-production.up.railway.app/login')).toBeNull();
    expect(extractQrToken('HOSTEL-ID-PASS:garbage')).toBeNull();
    expect(extractQrToken('')).toBeNull();
    expect(extractQrToken('   ')).toBeNull();
    expect(extractQrToken(null)).toBeNull();
    expect(extractQrToken(undefined)).toBeNull();
    expect(extractQrToken(42)).toBeNull();
    expect(extractQrToken('/resident-verification/short')).toBeNull();
  });
});

describe('manager scanner credential wiring (source assertions)', () => {
  it('resolves camera decodes through the shared helper before verification', () => {
    const src = modal();
    expect(src).toContain('extractQrToken');
    expect(src).toContain("import { extractQrToken } from '@hostel/shared'");
    expect(src).toContain('handleVerifyToken(decodedText');
  });

  it('sends only the extracted credential to the authenticated verification API', () => {
    const src = modal();
    expect(src).toMatch(/api\.verifyQR\(credential, method\)/);
    expect(src).not.toMatch(/api\.verifyQR\(clean, method\)/);
  });

  it('shows a visible INVALID result for unrecognized QR payloads instead of blank', () => {
    const src = modal();
    expect(src).toContain('INVALID_QR_MESSAGE');
    expect(src).toContain('INVALID_CREDENTIAL');
    expect(src).toContain('not a HostelOS resident pass');
  });

  it('never navigates the dashboard to a URL from a scanned QR payload', () => {
    const src = modal();
    expect(src).not.toContain('window.location');
    expect(src).not.toContain('window.open');
  });

  it('displays an explicit VERIFYING state so the stopped preview never reads blank', () => {
    const src = modal();
    expect(src).toContain('Verifying digital pass');
    expect(src).toContain('VERIFY_TIMEOUT_MS');
    expect(src).toContain('Verification timed out');
  });

  it('offers an explicit retry after verification errors', () => {
    const src = modal();
    expect(src).toContain('Retry verification');
    expect(src).toContain('lastAttempt');
  });

  it('guards result rendering with an error boundary instead of a white page', () => {
    const src = modal();
    expect(src).toContain('ScannerErrorBoundary');
    expect(src).toContain('getDerivedStateFromError');
  });

  it('keeps single-flight protection, cleanup, Scan Another and manual entry', () => {
    const src = modal();
    expect(src).toMatch(/if \(!clean \|\| verifyingRef\.current\) return;/);
    expect(src).toContain('.stop()');
    expect(src).toContain('Scan Another Digital Pass');
    expect(src).toContain('handleVerifyToken(manualToken');
    expect(src).toContain('Manual Token Entry');
  });

  it('maps backend outcomes to distinct result states including photo loading', () => {
    const src = modal();
    for (const marker of ['VALID_RESIDENT', 'INVALID_CREDENTIAL', 'EXPIRED', 'ATTENTION_REQUIRED']) {
      expect(src).toContain(marker);
    }
    expect(src).toContain('Loading approved photograph');
  });
});

describe('working SECURITY scanner preservation', () => {
  it('leaves the security scanner implementation untouched', () => {
    const src = fs.readFileSync(securityPath, 'utf8');
    expect(src).toContain('gate-scanner-reader');
    expect(src).toContain('Html5QrcodeScanner');
    expect(src).not.toContain('extractQrToken');
    expect(src).not.toContain('manager-qr-viewport');
    expect(src).not.toContain('qr-reader-container');
  });
});
