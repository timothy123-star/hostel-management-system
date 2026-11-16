import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const modalPath = path.resolve(__dirname, '../../frontend/src/components/QRScannerModal.tsx');
const cssPath = path.resolve(__dirname, '../../frontend/src/index.css');
const securityPath = path.resolve(__dirname, '../../frontend/src/pages/SecurityScannerPage.tsx');

const modal = () => fs.readFileSync(modalPath, 'utf8');
const css = () => fs.readFileSync(cssPath, 'utf8');
const security = () => fs.readFileSync(securityPath, 'utf8');

describe('manager QR scanner modal (camera + result handling)', () => {
  it('initializes the camera with an explicit environment-facing Html5Qrcode instance', () => {
    const src = modal();
    expect(src).toContain('Html5Qrcode');
    expect(src).not.toContain('Html5QrcodeScanner');
    expect(src).toContain("new Html5Qrcode('qr-reader-container'");
    expect(src).toContain("facingMode: 'environment'");
    expect(src).toContain('fps: 10');
    expect(src).toContain('qrbox: { width: 250, height: 250 }');
    expect(src).toContain("document.getElementById('qr-reader-container')");
  });

  it('passes recognized camera tokens to the authenticated verification API', () => {
    const src = modal();
    expect(src).toContain('api.verifyQR');
    expect(src).toContain("'CAMERA'");
    expect(src).toContain("'MANUAL_ENTRY'");
    expect(src).toContain('handleVerifyToken(decodedText');
  });

  it('blocks duplicate verification requests from repeated camera callbacks', () => {
    const src = modal();
    expect(src).toContain('verifyingRef');
    expect(src).toMatch(/if \(!clean \|\| verifyingRef\.current\) return;/);
  });

  it('stops camera tracks when the modal closes, unmounts, or a result arrives', () => {
    const src = modal();
    expect(src).toContain('.stop()');
    expect(src).toContain('.clear()');
    expect(src).toContain('scannerRef.current = null');
    // Effect only runs while the modal is open on the camera tab with no result.
    expect(src).toMatch(/if \(!isOpen \|\| activeTab !== 'camera' \|\| verificationResult\) return;/);
  });

  it('supports reopening and scanning another resident without reopening the dashboard', () => {
    const src = modal();
    expect(src).toContain('scanSession');
    expect(src).toContain('setScanSession');
    expect(src).toContain('Scan Another Digital Pass');
  });

  it('keeps manual token entry functional', () => {
    const src = modal();
    expect(src).toContain('Manual Token Entry');
    expect(src).toContain('handleVerifyToken(manualToken');
  });

  it('renders valid, invalid, expired and attention-required outcomes distinctly', () => {
    const src = modal();
    for (const marker of ['VALID_RESIDENT', 'INVALID_CREDENTIAL', 'EXPIRED', 'ATTENTION_REQUIRED']) {
      expect(src).toContain(marker);
    }
    expect(src).toContain('EXPIRED PASS');
    expect(src).toContain('ATTENTION REQUIRED');
  });

  it('fills and centers the camera preview via a manager-specific viewport', () => {
    const src = modal();
    expect(src).toContain('manager-qr-viewport');
    expect(src).toContain('id="qr-reader-container"');
    const styles = css();
    expect(styles).toContain('.manager-qr-viewport');
    expect(styles).toContain('object-fit: cover');
    expect(styles).toContain('align-items: center');
    expect(styles).toContain('justify-content: center');
    expect(styles).toContain('aspect-ratio');
  });
});

describe('working SECURITY scanner preservation', () => {
  it('leaves the security scanner implementation untouched', () => {
    const src = security();
    expect(src).toContain('gate-scanner-reader');
    expect(src).toContain('Html5QrcodeScanner');
    expect(src).toContain('rememberLastUsedCamera');
    expect(src).not.toContain('manager-qr-viewport');
    expect(src).not.toContain('qr-reader-container');
  });
});
