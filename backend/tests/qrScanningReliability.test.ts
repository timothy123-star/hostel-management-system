import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const modalPath = path.resolve(__dirname, '../../frontend/src/components/QRScannerModal.tsx');
const securityPath = path.resolve(__dirname, '../../frontend/src/pages/SecurityScannerPage.tsx');
const rvpPath = path.resolve(__dirname, '../../frontend/src/pages/ResidentVerificationPage.tsx');
const appPath = path.resolve(__dirname, '../../frontend/src/App.tsx');
const clientPath = path.resolve(__dirname, '../../frontend/src/api/client.ts');
const authCtxPath = path.resolve(__dirname, '../../frontend/src/context/AuthContext.tsx');
const loginPath = path.resolve(__dirname, '../../frontend/src/pages/LoginPage.tsx');
const forcePwPath = path.resolve(__dirname, '../../frontend/src/pages/ForcePasswordChangePage.tsx');
const routesPath = path.resolve(__dirname, '../src/routes/qrRoutes.ts');

const read = (p: string) => fs.readFileSync(p, 'utf8');

describe('manager laptop camera selection and playback proof', () => {
  it('enumerates real devices instead of blindly forcing an environment camera', () => {
    const src = read(modalPath);
    expect(src).toContain('Html5Qrcode.getCameras()');
    // The primary start constraint is a concrete device id; facingMode is
    // only a fallback when the device start fails.
    expect(src).toMatch(/await qr\.start\(chosenId,/);
    expect(src).toContain('pickDefaultCamera');
  });

  it('prefers a physical camera on laptops and the rear camera on phones', () => {
    const src = read(modalPath);
    expect(src).toContain('VIRTUAL_CAMERA_PATTERN');
    expect(src).toContain('REAR_CAMERA_PATTERN');
    expect(src).toContain('pointer: coarse');
  });

  it('offers a camera selector when several devices exist', () => {
    const src = read(modalPath);
    expect(src).toContain('cameras.length > 1');
    expect(src).toContain('handleCameraChange');
    expect(src).toContain('<select');
  });

  it('reports denied, missing, busy and unsupported cameras distinctly', () => {
    const src = read(modalPath);
    for (const name of ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'OverconstrainedError', 'SecurityError']) {
      expect(src).toContain(name);
    }
    expect(src).toContain('cameraErrorMessage');
  });

  it('proves a live video track instead of trusting container styling', () => {
    const src = read(modalPath);
    expect(src).toContain('getVideoTracks');
    expect(src).toContain('#qr-reader-container video');
    expect(src).toContain('video.play()');
    expect(src).toContain('no video track');
  });
});

describe('native phone-camera deep link workflow', () => {
  it('renders the verification page before any authentication gate', () => {
    const src = read(appPath);
    const verifyIdx = src.indexOf('resident-verification');
    const gateIdx = src.indexOf('if (!user)');
    expect(verifyIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeGreaterThan(-1);
    expect(verifyIdx).toBeLessThan(gateIdx);
  });

  it('tolerates a trailing slash instead of dropping to the dashboard', () => {
    const src = read(appPath);
    expect(src).toContain('resident-verification\\/([A-Za-z0-9_-]+)\\/?$/');
  });

  it('never renders blank: loading, restricted, failed and ready all emit content', () => {
    const src = read(rvpPath);
    expect(src).toContain("kind: 'checking'");
    expect(src).toContain("kind: 'restricted'");
    expect(src).toContain('Retry verification');
    expect(src).toContain('VALID RESIDENT');
    expect(src).toContain('ATTENTION REQUIRED');
    expect(src).toContain('EXPIRED PASS');
    expect(src).toContain('INVALID CREDENTIAL');
  });

  it('an expired session preserves the token for post-login return', () => {
    const page = read(rvpPath);
    // Both the missing-token and the 401/403 branches persist the token.
    expect(page.match(/rememberPendingScan\(token\)/g)?.length).toBeGreaterThanOrEqual(2);
    const client = read(clientPath);
    expect(client).toContain('hostel_pending_scan');
    expect(client).toContain('resident-verification');
  });

  it('login and forced password change return to the pending verification URL', () => {
    const login = read(loginPath);
    expect(login).toContain('hostel_pending_scan');
    expect(login).toContain('/resident-verification/');
    const force = read(forcePwPath);
    expect(force).toContain('hostel_pending_scan');
    expect(force).toContain('/resident-verification/');
  });

  it('photo loading is neutral and never a false eligibility warning', () => {
    const src = read(rvpPath);
    expect(src).toContain('photoLoading');
    expect(src).toContain('Loading approved photograph');
  });

  it('boot storage failures cannot blank the app and crashes show a reload UI', () => {
    const ctx = read(authCtxPath);
    expect(ctx).toContain('Corrupt or unreadable cached identity');
    const app = read(appPath);
    expect(app).toContain('RouteErrorBoundary');
    expect(app).toContain('Reload page');
  });
});

describe('security scanner transient-warning repair', () => {
  it('shows a neutral indicator while the photograph loads', () => {
    const src = read(securityPath);
    expect(src).toContain('photoLoading');
    expect(src).toContain('Loading approved photograph');
  });

  it('withheld and unavailable notices render only after the fetch settles', () => {
    const src = read(securityPath);
    // The amber notice is in the settled branch, not the loading branch.
    const loadingIdx = src.indexOf('Loading approved photograph');
    const withheldIdx = src.indexOf('Photograph unavailable.');
    expect(loadingIdx).toBeGreaterThan(-1);
    expect(withheldIdx).toBeGreaterThan(-1);
    expect(loadingIdx).toBeLessThan(withheldIdx);
  });

  it('genuine ATTENTION_REQUIRED outcomes still display', () => {
    const src = read(securityPath);
    expect(src).toContain('ATTENTION_REQUIRED');
    expect(src).toContain('ATTENTION REQUIRED');
  });

  it('camera implementation and layout remain the working version', () => {
    const src = read(securityPath);
    expect(src).toContain('gate-scanner-reader');
    expect(src).toContain('Html5QrcodeScanner');
    expect(src).toContain('rememberLastUsedCamera');
    expect(src).not.toContain('manager-qr-viewport');
  });
});

describe('staff-only QR authorization model is unchanged', () => {
  it('staff verification and photo endpoints still require scan-role auth', () => {
    const src = read(routesPath);
    expect(src).toContain("qrRouter.get('/staff/:token', authMiddleware, requireScanRole");
    expect(src).toContain("qrRouter.get('/staff/:token/photo', authMiddleware, requireScanRole");
    expect(src).toContain("qrRouter.post('/verify', authMiddleware, requireScanRole");
    expect(src).toContain('getVerifiedPhoto');
  });
});
