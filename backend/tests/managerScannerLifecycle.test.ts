import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { Html5QrcodeScannerState, type Html5Qrcode } from 'html5-qrcode';
import { stopManagerScannerInstance } from '../../frontend/src/components/QRScannerModal.tsx';

const modalPath = path.resolve(__dirname, '../../frontend/src/components/QRScannerModal.tsx');
const securityPath = path.resolve(__dirname, '../../frontend/src/pages/SecurityScannerPage.tsx');

/**
 * Faithful mock of the installed html5-qrcode stop/state contract:
 * stop() throws SYNCHRONOUSLY (no Promise) unless the scanner is
 * SCANNING or PAUSED, and the transition to NOT_STARTED completes
 * asynchronously after renderedCamera.close() resolves.
 */
class MockScanner {
  state = Html5QrcodeScannerState.NOT_STARTED;
  stopCalls = 0;
  clearCalls = 0;
  failStopAsync = false;

  async start() {
    this.state = Html5QrcodeScannerState.SCANNING;
  }
  getState() {
    return this.state;
  }
  stop() {
    if (this.state !== Html5QrcodeScannerState.SCANNING && this.state !== Html5QrcodeScannerState.PAUSED) {
      throw 'Cannot stop, scanner is not running or paused.';
    }
    this.stopCalls += 1;
    if (this.failStopAsync) return Promise.reject(new Error('camera close failed'));
    return Promise.resolve().then(() => {
      this.state = Html5QrcodeScannerState.NOT_STARTED;
    });
  }
  clear() {
    if (this.state === Html5QrcodeScannerState.SCANNING || this.state === Html5QrcodeScannerState.PAUSED) {
      throw 'Cannot clear while scan is ongoing, close it first.';
    }
    this.clearCalls += 1;
  }
  asHtml5Qrcode() {
    return this as unknown as Html5Qrcode;
  }
}

describe('manager scanner lifecycle-safe stop', () => {
  it('stops an actively scanning instance and clears its element', async () => {
    const scanner = new MockScanner();
    await scanner.start();
    await stopManagerScannerInstance(scanner.asHtml5Qrcode());
    expect(scanner.stopCalls).toBe(1);
    expect(scanner.clearCalls).toBe(1);
    expect(scanner.getState()).toBe(Html5QrcodeScannerState.NOT_STARTED);
  });

  it('stops a paused instance', async () => {
    const scanner = new MockScanner();
    scanner.state = Html5QrcodeScannerState.PAUSED;
    await stopManagerScannerInstance(scanner.asHtml5Qrcode());
    expect(scanner.stopCalls).toBe(1);
    expect(scanner.getState()).toBe(Html5QrcodeScannerState.NOT_STARTED);
  });

  it('successful scan then effect cleanup: no second stop is attempted', async () => {
    const scanner = new MockScanner();
    await scanner.start();
    // handleVerifyToken phase.
    await stopManagerScannerInstance(scanner.asHtml5Qrcode());
    expect(scanner.stopCalls).toBe(1);
    // Effect cleanup phase with the stale reference to the stopped scanner.
    await stopManagerScannerInstance(scanner.asHtml5Qrcode());
    expect(scanner.stopCalls).toBe(1);
    expect(scanner.clearCalls).toBe(1);
  });

  it('cleanup on an already-stopped scanner throws nothing', async () => {
    const scanner = new MockScanner();
    await expect(stopManagerScannerInstance(scanner.asHtml5Qrcode())).resolves.toBeUndefined();
    expect(scanner.stopCalls).toBe(0);
  });

  it('modal close while idle throws nothing', async () => {
    await expect(stopManagerScannerInstance(null)).resolves.toBeUndefined();
    await expect(stopManagerScannerInstance(undefined)).resolves.toBeUndefined();
    await expect(stopManagerScannerInstance(new MockScanner().asHtml5Qrcode())).resolves.toBeUndefined();
  });

  it('never issues concurrent stops on the same instance', async () => {
    const scanner = new MockScanner();
    await scanner.start();
    await Promise.all([
      stopManagerScannerInstance(scanner.asHtml5Qrcode()),
      stopManagerScannerInstance(scanner.asHtml5Qrcode())
    ]);
    expect(scanner.stopCalls).toBe(1);
  });

  it('contains an asynchronous stop rejection', async () => {
    const scanner = new MockScanner();
    await scanner.start();
    scanner.failStopAsync = true;
    await expect(stopManagerScannerInstance(scanner.asHtml5Qrcode())).resolves.toBeUndefined();
    expect(scanner.stopCalls).toBe(1);
  });

  it('leaves a start-in-progress instance alone', async () => {
    const scanner = new MockScanner();
    await expect(stopManagerScannerInstance(scanner.asHtml5Qrcode())).resolves.toBeUndefined();
    expect(scanner.stopCalls).toBe(0);
    expect(scanner.clearCalls).toBe(0);
  });

  it('returns quietly when scanner state is unreadable', async () => {
    const broken = { getState: () => { throw new Error('gone'); } } as unknown as Html5Qrcode;
    await expect(stopManagerScannerInstance(broken)).resolves.toBeUndefined();
  });
});

describe('manager scanner wiring (source assertions)', () => {
  it('routes effect cleanup and reset through the safe stop operation', () => {
    const src = fs.readFileSync(modalPath, 'utf8');
    expect(src).toContain('stopManagerScannerInstance');
    expect(src).toContain('Html5QrcodeScannerState');
    expect(src).not.toContain('inst.stop().catch');
    // The remaining raw stop (pre-start dedup) stays inside try/catch.
    expect(src).toContain('try { await prev.stop(); } catch { /* already stopped */ }');
  });

  it('releases the stale closure reference on cleanup', () => {
    const src = fs.readFileSync(modalPath, 'utf8');
    expect(src).toMatch(/const inst = instance \?\? scannerRef\.current;/);
    expect(src).toContain('instance = null;');
  });

  it('keeps Scan Another working through the safe operation', () => {
    const src = fs.readFileSync(modalPath, 'utf8');
    expect(src).toContain('Scan Another Digital Pass');
    expect(src).toMatch(/void stopManagerScannerInstance\(inst\);/);
    expect(src).toContain('setScanSession((s) => s + 1)');
  });
});

describe('working SECURITY scanner preservation', () => {
  it('leaves the security scanner implementation untouched', () => {
    const src = fs.readFileSync(securityPath, 'utf8');
    expect(src).toContain('Html5QrcodeScanner');
    expect(src).not.toContain('stopManagerScannerInstance');
    expect(src).not.toContain('extractQrToken');
  });
});
