import React, { useState, useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
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
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

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

  useEffect(() => {
    if (isOpen && activeTab === 'camera') {
      const timer = setTimeout(() => {
        try {
          const scanner = new Html5QrcodeScanner(
            'qr-reader-container',
            {
              fps: 10,
              qrbox: { width: 250, height: 250 },
              rememberLastUsedCamera: true
            },
            /* verbose= */ false
          );

          scanner.render(
            async (decodedText) => {
              scanner.clear();
              await handleVerifyToken(decodedText, 'CAMERA');
            },
            (error) => {
              // Ignore ongoing frame scanning errors
            }
          );
          scannerRef.current = scanner;
        } catch (err: any) {
          setScannerError('Could not initialize camera scanner. You can enter the verification token manually below.');
        }
      }, 300);

      return () => {
        clearTimeout(timer);
        if (scannerRef.current) {
          try {
            scannerRef.current.clear();
          } catch (e) {}
          scannerRef.current = null;
        }
      };
    }
  }, [isOpen, activeTab]);

  const handleVerifyToken = async (token: string, method: 'CAMERA' | 'MANUAL_ENTRY' = 'MANUAL_ENTRY') => {
    if (!token.trim()) return;
    setIsVerifying(true);
    setScannerError(null);
    try {
      const result = await api.verifyQR(token.trim(), method);
      setVerificationResult(result);
      if (onVerificationComplete) onVerificationComplete();
    } catch (err: any) {
      setScannerError(err.message || 'Verification failed');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleReset = () => {
    setVerificationResult(null);
    setPhotoSrc(null);
    setManualToken('');
    setScannerError(null);
    if (activeTab === 'camera') {
      // re-trigger scanner
      setActiveTab('manual');
      setTimeout(() => setActiveTab('camera'), 50);
    }
  };

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
                verificationResult.outcome === 'GRANTED'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              {verificationResult.outcome === 'GRANTED' ? (
                <CheckCircle2 className="w-8 h-8 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-8 h-8 text-rose-600 shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-lg">
                    {verificationResult.outcome === 'GRANTED' ? 'ACCESS GRANTED' : 'ACCESS DENIED'}
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
                <div
                  id="qr-reader-container"
                  className="rounded-xl overflow-hidden border border-slate-200 min-h-[280px] bg-slate-100 flex items-center justify-center"
                />
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
