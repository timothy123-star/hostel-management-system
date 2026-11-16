import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Modal } from './Modal.js';
import { api } from '../api/client.js';
import { Camera, Keyboard, CheckCircle2, XCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { StatusBadge } from './StatusBadge.js';

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onVerificationComplete?: () => void;
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
  const [scanSession, setScanSession] = useState(0);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const verifyingRef = useRef(false);

  // The approved photograph is served by an authenticated staff-only
  // endpoint, so it is fetched with the staff Bearer token (never rendered
  // as an unauthenticated <img> URL). Revoked on result change/unmount.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setPhotoSrc(null);
    const remoteUrl: string | undefined = verificationResult?.student?.photo_url;
    if (!remoteUrl) return;
    api.fetchStaffPhoto(remoteUrl)
      .then((url) => { if (!cancelled) { objectUrl = url; setPhotoSrc(url); } else { URL.revokeObjectURL(url); } })
      .catch(() => { if (!cancelled) setPhotoSrc(null); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [verificationResult]);

  const handleVerifyToken = useCallback(async (token: string, method: 'CAMERA' | 'MANUAL_ENTRY' = 'MANUAL_ENTRY') => {
    const clean = token.trim();
    // Single-flight guard: repeated camera callbacks must not launch
    // overlapping verification requests.
    if (!clean || verifyingRef.current) return;
    verifyingRef.current = true;
    setIsVerifying(true);
    setScannerError(null);
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
      const result = await api.verifyQR(clean, method);
      setVerificationResult(result);
      if (onVerificationComplete) onVerificationComplete();
    } catch (err: any) {
      setScannerError(err.message || 'Verification failed');
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
        const qr = new Html5Qrcode('qr-reader-container', { verbose: false } as any);
        instance = qr;
        scannerRef.current = qr;
        await qr.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
          (decodedText) => {
            void handleVerifyToken(decodedText, 'CAMERA');
          },
          () => {
            // Ignore ongoing frame scanning errors
          }
        );
        if (cancelled) {
          scannerRef.current = null;
          try { await qr.stop(); } catch { /* already stopped */ }
          try { qr.clear(); } catch { /* already cleared */ }
        }
      } catch (err: any) {
        if (!cancelled) setScannerError('Could not initialize camera scanner. You can enter the verification token manually below.');
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
    };
  }, [isOpen, activeTab, verificationResult, scanSession, handleVerifyToken]);

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
    setVerificationResult(null);
    setPhotoSrc(null);
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
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>{scannerError}</span>
              </div>
            )}

            {/* Camera View */}
            {activeTab === 'camera' && (
              <div className="space-y-3">
                <div className="manager-qr-viewport relative w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-900">
                  <div id="qr-reader-container" className="manager-qr-reader" />
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
    </Modal>
  );
};
