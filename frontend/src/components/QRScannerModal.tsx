import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Modal } from './Modal.js';
import { api } from '../api/client.js';
import { Camera, Keyboard, CheckCircle2, XCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { StatusBadge } from './StatusBadge.js';
import { extractQrToken } from '@hostel/shared';

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onVerificationComplete?: () => void;
}

const VERIFY_TIMEOUT_MS = 20000;

const INVALID_QR_MESSAGE =
  'This QR code is not a HostelOS resident pass. Scan a valid resident QR or enter the token manually.';

/** Local error boundary: a render failure inside the scanner must show a
 * retry state, never a blank result or a white page. */
class ScannerErrorBoundary extends React.Component<
  { onReset: () => void; children: React.ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(err: unknown) {
    return { error: err instanceof Error ? err.message : 'The scanner view failed to render.' };
  }
  componentDidCatch() { /* surfaced in the retry state below */ }
  render() {
    if (this.state.error) {
      return (
        <div className="space-y-4">
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-sm">
            The scanner view ran into a problem. No result was lost — try scanning again.
          </div>
          <button
            onClick={() => { this.setState({ error: null }); this.props.onReset(); }}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 transition"
          >
            <RefreshCw className="w-4 h-4" /> Scan Another Digital Pass
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export const QRScannerModal: React.FC<QRScannerModalProps> = ({
  isOpen,
  onClose,
  onVerificationComplete
}) => {
  const [activeTab, setActiveTab] = useState<'camera' | 'manual'>('camera');
  const [manualToken, setManualToken] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<any | null>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [photoSrc, setPhotoSrc] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [scanSession, setScanSession] = useState(0);
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [cameraStarting, setCameraStarting] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const verifyingRef = useRef(false);
  const [lastAttempt, setLastAttempt] = useState<{ token: string; method: 'CAMERA' | 'MANUAL_ENTRY' } | null>(null);
  const selectedCameraRef = useRef<string | null>(null);

// Labels are empty until the user grants camera permission; matching is
// therefore best-effort. Known virtual/screen-share devices are deprioritized
// on laptops because they can render a solid placeholder frame.
const VIRTUAL_CAMERA_PATTERN = /virtual|obs|snap|manycam|screen|teams|zoom|vcam|droidcam|epoccam/i;
const REAR_CAMERA_PATTERN = /back|rear|environment/i;

function isCoarsePointer() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
}

function pickDefaultCamera(devices: Array<{ id: string; label: string }>, preferredId: string | null) {
  if (preferredId && devices.some((d) => d.id === preferredId)) return preferredId;
  if (isCoarsePointer()) {
    const rear = devices.find((d) => REAR_CAMERA_PATTERN.test(d.label || ''));
    return (rear ?? devices[0])?.id ?? null;
  }
  const physical = devices.find((d) => !VIRTUAL_CAMERA_PATTERN.test(d.label || ''));
  return (physical ?? devices[0])?.id ?? null;
}

function cameraErrorMessage(err: any) {
  const name = String(err?.name || '');
  const detail = String(err?.message || err || '');
  if (name === 'NotAllowedError' || /permission|denied|not allowed/i.test(detail)) {
    return 'Camera permission was denied. Allow camera access for this site in the browser address bar, then reopen the scanner or use manual token entry.';
  }
  if (name === 'NotFoundError' || /not found|no camera|no video/i.test(detail)) {
    return 'No camera device was found. Connect a camera, or enter the verification token manually below.';
  }
  if (name === 'NotReadableError' || /in use|busy|track|failed to allocate/i.test(detail)) {
    return 'The camera is already in use by another app or browser tab. Close the other app or tab and try scanning again, or use manual token entry.';
  }
  if (name === 'OverconstrainedError' || /constraint/i.test(detail)) {
    return 'The selected camera does not support the requested mode. Try another camera from the list, or use manual token entry.';
  }
  if (name === 'SecurityError' || /secure|https/i.test(detail)) {
    return 'Camera access requires a secure (HTTPS) page. Open the dashboard over HTTPS, or use manual token entry.';
  }
  return 'Could not initialize camera scanner. You can enter the verification token manually below.';
}

  // The approved photograph is served by an authenticated staff-only
  // endpoint, so it is fetched with the staff Bearer token (never rendered
  // as an unauthenticated <img> URL). Revoked on result change/unmount.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setPhotoSrc(null);
    const remoteUrl: string | undefined = verificationResult?.student?.photo_url;
    if (!remoteUrl) {
      setPhotoLoading(false);
      return;
    }
    setPhotoLoading(true);
    api.fetchStaffPhoto(remoteUrl)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setPhotoSrc(url);
      })
      .catch(() => { if (!cancelled) setPhotoSrc(null); })
      .finally(() => { if (!cancelled) setPhotoLoading(false); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [verificationResult]);

  const handleVerifyToken = useCallback(async (token: string, method: 'CAMERA' | 'MANUAL_ENTRY' = 'MANUAL_ENTRY') => {
    const clean = token.trim();
    // Single-flight guard: repeated camera callbacks must not launch
    // overlapping verification requests.
    if (!clean || verifyingRef.current) return;
    // Issued QR codes encode the full resident-verification URL while the
    // verification API expects only the opaque token. Camera decodes must
    // therefore resolve to a token first; anything else is a visible
    // INVALID result, never a blank state, and the dashboard never
    // navigates to a URL taken from an untrusted QR payload. Manual entry
    // keeps accepting a pasted raw token or URL and falls back to sending
    // the trimmed input so legacy/demo values still reach the server,
    // which remains the authority on credential validity.
    const extracted = extractQrToken(clean);
    const credential = method === 'CAMERA' ? extracted : (extracted ?? clean);
    if (!credential) {
      setVerificationResult({ outcome: 'DENIED', status: 'INVALID_CREDENTIAL', reason: INVALID_QR_MESSAGE });
      if (onVerificationComplete) onVerificationComplete();
      return;
    }
    verifyingRef.current = true;
    setIsVerifying(true);
    setScannerError(null);
    setLastAttempt({ token: credential, method });
    if (method === 'CAMERA') {
      // Freeze the preview immediately so further frames cannot re-fire
      // while the authenticated verification request is in flight.
      const inst = scannerRef.current;
      scannerRef.current = null;
      if (inst) {
        try { await inst.stop(); } catch { /* already stopped */ }
        try { inst.clear(); } catch { /* already cleared */ }
      }
    }
    try {
      // Bound the request: without a timeout a stalled network leaves the
      // cleared camera viewport on a blank state with no way to retry.
      const result = await Promise.race([
        api.verifyQR(credential, method),
        new Promise((_, reject) => setTimeout(
          () => reject(new Error('Verification timed out. Check your connection and retry the scan.')),
          VERIFY_TIMEOUT_MS
        ))
      ]) as any;
      setVerificationResult(result);
      setLastAttempt(null);
      if (onVerificationComplete) onVerificationComplete();
    } catch (err: any) {
      setScannerError(err.message || 'Verification failed. Check your connection and retry the scan.');
      verifyingRef.current = false;
      // Restart the preview so a failed camera scan can be retried
      // without reopening the dashboard.
      if (method === 'CAMERA') setScanSession((s) => s + 1);
    } finally {
      setIsVerifying(false);
      if (method === 'MANUAL_ENTRY') verifyingRef.current = false;
    }
  }, [onVerificationComplete]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'camera' || verificationResult) return;
    let cancelled = false;
    let instance: Html5Qrcode | null = null;
    setCameraStarting(true);
    setScannerError(null);
    const timer = setTimeout(async () => {
      if (cancelled) return;
      try {
        // Never leave a previous camera instance running: opening and
        // closing the modal repeatedly must not create duplicates.
        if (scannerRef.current) {
          const prev = scannerRef.current;
          scannerRef.current = null;
          try { await prev.stop(); } catch { /* already stopped */ }
          try { prev.clear(); } catch { /* already cleared */ }
        }
        if (cancelled) return;
        if (!document.getElementById('qr-reader-container')) return;
        // Enumerate real devices instead of blindly forcing an environment
        // (rear) camera: laptops usually have no rear camera, and a
        // facingMode guess can resolve to a virtual device that renders a
        // solid placeholder frame instead of a live preview.
        let devices: Array<{ id: string; label: string }> = [];
        try {
          devices = await Html5Qrcode.getCameras();
        } catch {
          throw { name: 'NotFoundError', message: 'Camera enumeration failed.' };
        }
        if (cancelled) return;
        if (!devices.length) {
          throw { name: 'NotFoundError', message: 'No camera devices found.' };
        }
        if (!cancelled) setCameras(devices);
        const chosenId = pickDefaultCamera(devices, selectedCameraRef.current);
        if (chosenId !== selectedCameraRef.current) {
          selectedCameraRef.current = chosenId;
          if (!cancelled) setSelectedCameraId(chosenId);
        }
        if (cancelled) return;
        if (!chosenId) {
          throw { name: 'NotFoundError', message: 'No camera devices found.' };
        }
        const qr = new Html5Qrcode('qr-reader-container', { verbose: false } as any);
        instance = qr;
        scannerRef.current = qr;
        const config = { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 };
        const onScanSuccess = (decodedText: string) => {
          void handleVerifyToken(decodedText, 'CAMERA');
        };
        const onScanFailure = () => {
          // Ignore ongoing frame scanning errors
        };
        try {
          // A concrete deviceId is the most reliable constraint on
          // laptops/desktops with one or more physical cameras.
          await qr.start(chosenId, config, onScanSuccess, onScanFailure);
        } catch (deviceErr: any) {
          const name = String(deviceErr?.name || '');
          // Permission failures will fail the same way on retry: surface
          // them immediately instead of masking them behind a fallback.
          if (name === 'NotAllowedError' || name === 'SecurityError') throw deviceErr;
          // Otherwise fall back to a facing-mode request (rear on phones,
          // front on laptops/desktops).
          await qr.start({ facingMode: isCoarsePointer() ? 'environment' : 'user' }, config, onScanSuccess, onScanFailure);
        }
        // Prove the video element actually carries a live stream: a styled
        // container background alone is not proof the camera is working.
        const video = document.querySelector('#qr-reader-container video') as HTMLVideoElement | null;
        const tracks = (video?.srcObject as MediaStream | null)?.getVideoTracks?.() ?? [];
        if (!video || tracks.length === 0 || (tracks[0] as MediaStreamTrack).readyState === 'ended') {
          throw { name: 'NotReadableError', message: 'The camera produced no video track.' };
        }
        try { await video.play(); } catch { /* autoplay is managed by the library */ }
        if (cancelled) {
          scannerRef.current = null;
          try { await qr.stop(); } catch { /* already stopped */ }
          try { qr.clear(); } catch { /* already cleared */ }
        }
      } catch (err: any) {
        if (!cancelled) {
          const inst = instance ?? scannerRef.current;
          scannerRef.current = null;
          instance = null;
          if (inst) {
            try { await inst.stop(); } catch { /* already stopped */ }
            try { inst.clear(); } catch { /* already cleared */ }
          }
          setScannerError(cameraErrorMessage(err));
        }
      } finally {
        if (!cancelled) setCameraStarting(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      const inst = instance ?? scannerRef.current;
      scannerRef.current = null;
      if (inst) {
        inst.stop().catch(() => {}).finally(() => {
          try { inst.clear(); } catch { /* already cleared */ }
        });
      }
      verifyingRef.current = false;
      setCameraStarting(false);
    };
  }, [isOpen, activeTab, verificationResult, scanSession, handleVerifyToken]);

  const handleCameraChange = useCallback((deviceId: string) => {
    selectedCameraRef.current = deviceId;
    setSelectedCameraId(deviceId);
    // Bump the session so the effect stops the current stream and starts
    // exactly one preview instance on the newly selected device.
    setScanSession((s) => s + 1);
  }, []);

  const handleReset = useCallback(() => {
    const inst = scannerRef.current;
    scannerRef.current = null;
    if (inst) {
      inst.stop().catch(() => {}).finally(() => {
        try { inst.clear(); } catch { /* already cleared */ }
      });
    }
    verifyingRef.current = false;
    setIsVerifying(false);
    setLastAttempt(null);
    setVerificationResult(null);
    setPhotoSrc(null);
    setPhotoLoading(false);
    setCameraStarting(false);
    setManualToken('');
    setScannerError(null);
    setActiveTab('camera');
    // Bump the session so the camera effect re-initializes exactly one
    // preview instance for the next resident.
    setScanSession((s) => s + 1);
  }, []);

  const displayStatus = !verificationResult
    ? null
    : verificationResult.outcome === 'GRANTED'
      ? 'VALID_RESIDENT'
      : /expired/i.test(String(verificationResult.reason || '')) || verificationResult.status === 'EXPIRED'
        ? 'EXPIRED'
        : verificationResult.status === 'ATTENTION_REQUIRED'
          ? 'ATTENTION_REQUIRED'
          : 'INVALID_CREDENTIAL';

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        handleReset();
        onClose();
      }}
      title="Hostel Gate Security & Digital QR Scanner"
      maxWidth="lg"
    >
      <ScannerErrorBoundary onReset={handleReset}>
      <div className="space-y-4">
        {/* Verification Result Display */}
        {verificationResult ? (
          <div className="space-y-4">
            <div
              className={`p-4 rounded-xl border flex items-start gap-4 ${
                displayStatus === 'VALID_RESIDENT'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : displayStatus === 'ATTENTION_REQUIRED'
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              {displayStatus === 'VALID_RESIDENT' ? (
                <CheckCircle2 className="w-8 h-8 text-emerald-600 shrink-0 mt-0.5" />
              ) : displayStatus === 'ATTENTION_REQUIRED' ? (
                <AlertTriangle className="w-8 h-8 text-amber-600 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-8 h-8 text-rose-600 shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-lg">
                    {displayStatus === 'VALID_RESIDENT'
                      ? 'ACCESS GRANTED'
                      : displayStatus === 'ATTENTION_REQUIRED'
                        ? 'ATTENTION REQUIRED'
                        : displayStatus === 'EXPIRED'
                          ? 'EXPIRED PASS'
                          : 'ACCESS DENIED'}
                  </h4>
                  <StatusBadge status={verificationResult.outcome} />
                </div>
                <p className="text-sm mt-1">{verificationResult.reason}</p>
              </div>
            </div>

            {verificationResult.student && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="flex flex-col items-center text-center">
                  {photoLoading ? (
                    <div className="flex w-44 h-44 items-center justify-center rounded-2xl bg-slate-100 border border-slate-200">
                      <p className="px-3 text-center text-xs text-slate-500">Loading approved photograph…</p>
                    </div>
                  ) : (
                    <>
                      <img
                        src={photoSrc || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(verificationResult.student.full_name)}`}
                        alt={photoSrc ? `Approved photograph of ${verificationResult.student.full_name} for identity comparison` : `Identity placeholder for ${verificationResult.student.full_name}`}
                        className="w-44 h-44 rounded-2xl bg-white border-2 border-emerald-500 object-cover shadow-sm"
                      />
                      <p className="mt-2 text-xs font-medium text-emerald-800">
                        {photoSrc
                          ? 'Approved photograph — compare with the person present.'
                          : 'No approved photograph on file — verify name, facility, room and dates with management.'}
                      </p>
                    </>
                  )}
                </div>
                <div className="mt-3 flex-1 text-sm space-y-1">
                  <p className="font-semibold text-base text-slate-900">
                    {verificationResult.student.full_name}
                  </p>
                  <p className="text-slate-600">
                    <span className="font-medium">Facility:</span> {verificationResult.hostel?.name || verificationResult.hostel?.code}
                  </p>
                  <p className="text-slate-600">
                    <span className="font-medium">Room Assigned:</span> {verificationResult.room?.room_number || 'N/A'}
                  </p>
                  <p className="text-slate-600">
                    <span className="font-medium">Department:</span> {verificationResult.student.department} ({verificationResult.student.academic_level})
                  </p>
                  <p className="text-slate-600">
                    <span className="font-medium">Valid Period:</span> {verificationResult.allocation?.start_date} to {verificationResult.allocation?.end_date}
                  </p>
                </div>
              </div>
            )}

            <button
              onClick={handleReset}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 transition"
            >
              <RefreshCw className="w-4 h-4" /> Scan Another Digital Pass
            </button>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex border-b border-slate-200">
              <button
                type="button"
                onClick={() => {
                  setScannerError(null);
                  setActiveTab('camera');
                }}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
                  activeTab === 'camera'
                    ? 'border-brand-600 text-brand-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <Camera className="w-4 h-4" /> Live Camera Scanner
              </button>
              <button
                type="button"
                onClick={() => {
                  setScannerError(null);
                  setActiveTab('manual');
                }}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
                  activeTab === 'manual'
                    ? 'border-brand-600 text-brand-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <Keyboard className="w-4 h-4" /> Manual Token Entry
              </button>
            </div>

            {scannerError && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-xs">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>{scannerError}</span>
                </div>
                {lastAttempt && !isVerifying && (
                  <button
                    type="button"
                    onClick={() => void handleVerifyToken(lastAttempt.token, lastAttempt.method)}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-100 px-3 py-1.5 font-semibold text-amber-900 hover:bg-amber-200 transition"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Retry verification
                  </button>
                )}
              </div>
            )}

            {/* Camera View */}
            {activeTab === 'camera' && (
              <div className="space-y-3">
                {cameras.length > 1 && (
                  <label className="block text-xs font-semibold text-slate-600">
                    Camera
                    <select
                      value={selectedCameraId ?? ''}
                      onChange={(e) => handleCameraChange(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                      {cameras.map((c, i) => (
                        <option key={c.id} value={c.id}>
                          {c.label || `Camera ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="manager-qr-viewport relative w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-900">
                  <div id="qr-reader-container" className="manager-qr-reader" />
                  {cameraStarting && !scannerError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-900/70">
                      <p className="text-xs font-medium text-slate-200">Starting camera…</p>
                    </div>
                  )}
                  {isVerifying && !verificationResult && (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-900/70">
                      <p className="text-xs font-medium text-slate-200">Verifying digital pass…</p>
                    </div>
                  )}
                </div>
                <p className="text-xs text-slate-500 text-center">
                  Point the camera at the student's digital WhatsApp identity QR code.
                </p>
              </div>
            )}

            {/* Manual Token Entry */}
            {activeTab === 'manual' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleVerifyToken(manualToken, 'MANUAL_ENTRY');
                }}
                className="space-y-4 py-2"
              >
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                    Identity Verification Token or Hash
                  </label>
                  <input
                    type="text"
                    value={manualToken}
                    onChange={(e) => setManualToken(e.target.value)}
                    placeholder="Paste HOSTEL-ID-PASS:... token or SHA-256 hash"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
                    required
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Demo Active Token (John Doe): <code className="bg-slate-100 px-1 py-0.5 rounded text-[11px] font-mono">stu-demo-01</code> token
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={isVerifying || !manualToken.trim()}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 transition disabled:opacity-50"
                >
                  {isVerifying ? 'Verifying Digital Pass...' : 'Verify Pass Identity'}
                </button>
              </form>
            )}
          </>
        )}
      </div>
      </ScannerErrorBoundary>
    </Modal>
  );
};
