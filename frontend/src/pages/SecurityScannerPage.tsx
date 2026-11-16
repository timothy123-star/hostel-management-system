import React, { useState, useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { useAuth } from '../context/AuthContext.js';
import { api } from '../api/client.js';
import { SECURITY_PASSWORD_MIN_LENGTH } from '@hostel/shared';
import {
  Camera, Keyboard, CheckCircle2, XCircle, AlertTriangle, RefreshCw, LogOut, KeyRound, ScanLine
} from 'lucide-react';

type ScanStatus = 'VALID_RESIDENT' | 'ATTENTION_REQUIRED' | 'EXPIRED' | 'INVALID_CREDENTIAL';

/**
 * Dedicated gate scanner for SECURITY staff (MANAGER may use it too).
 * Mobile-first: large scan area, 48px touch targets, no manager navigation.
 */
export const SecurityScannerPage: React.FC = () => {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'camera' | 'manual'>('camera');
  const [manualToken, setManualToken] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [photoSrc, setPhotoSrc] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  // The approved photograph loads asynchronously after identity verification.
  // While it is in flight a neutral loading indicator is shown; the amber
  // withheld/unavailable notice only renders once the fetch has settled, so
  // a transient warning never flashes before the final resident details.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setPhotoSrc(null);
    const remoteUrl: string | undefined = result?.student?.photo_url;
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
  }, [result]);

  useEffect(() => {
    if (result || activeTab !== 'camera') return;
    const timer = setTimeout(() => {
      try {
        const scanner = new Html5QrcodeScanner(
          'gate-scanner-reader',
          { fps: 10, qrbox: { width: 260, height: 260 }, rememberLastUsedCamera: true },
          false
        );
        scanner.render(
          async (decodedText) => {
            scanner.clear();
            await verify(decodedText, 'CAMERA');
          },
          () => { /* ignore frame errors */ }
        );
        scannerRef.current = scanner;
      } catch {
        setCameraError('Camera could not be started. Use manual entry below or check browser camera permission.');
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      if (scannerRef.current) {
        try { scannerRef.current.clear(); } catch { /* already cleared */ }
        scannerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, result]);

  const verify = async (token: string, method: 'CAMERA' | 'MANUAL_ENTRY') => {
    const clean = token.trim();
    if (!clean || isVerifying) return;
    setIsVerifying(true);
    setCameraError(null);
    try {
      const res = await api.verifyQR(clean, method);
      setResult(res);
    } catch (err: any) {
      setCameraError(err.message || 'Verification failed. Try again.');
    } finally {
      setIsVerifying(false);
    }
  };

  const scanNext = () => {
    setResult(null);
    setPhotoSrc(null);
    setManualToken('');
    setCameraError(null);
    if (activeTab === 'camera') {
      setActiveTab('manual');
      setTimeout(() => setActiveTab('camera'), 60);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    if (newPw !== confirmPw) {
      setPwMsg('The new passwords do not match.');
      return;
    }
    try {
      await api.changePassword(currentPw, newPw, confirmPw);
      setPwMsg('Password changed. Use it next time you sign in.');
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
    } catch (err: any) {
      setPwMsg(err.message || 'Password change failed.');
    }
  };

  const status: ScanStatus | null = result
    ? (result.outcome === 'GRANTED' ? 'VALID_RESIDENT'
      : /expired/i.test(result.reason || '') ? 'EXPIRED'
      : result.status === 'ATTENTION_REQUIRED' ? 'ATTENTION_REQUIRED' : 'INVALID_CREDENTIAL')
    : null;

  return (
    <div className="min-h-dvh bg-slate-950 text-white flex flex-col">
      <header className="flex items-center justify-between gap-2 px-4 py-3 bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <ScanLine className="w-5 h-5 text-brand-400 shrink-0" />
          <div className="min-w-0">
            <p className="font-bold text-sm truncate">Gate Scanner</p>
            <p className="text-[11px] text-slate-400 truncate">{user?.full_name || user?.username || 'Security staff'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowPassword((v) => !v)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-300 hover:bg-slate-800"
            title="Change password"
          >
            <KeyRound className="w-5 h-5" />
          </button>
          <button
            onClick={logout}
            className="min-h-[44px] px-4 flex items-center gap-2 rounded-xl bg-slate-800 text-sm font-semibold hover:bg-slate-700"
          >
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </header>

      {showPassword && (
        <form onSubmit={changePassword} className="px-4 pt-3 space-y-2 shrink-0">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              placeholder="Current password"
              className="flex-1 min-h-[44px] px-3 rounded-xl bg-slate-900 border border-slate-700 text-base"
              required
            />
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="New password (12+ characters)"
              className="flex-1 min-h-[44px] px-3 rounded-xl bg-slate-900 border border-slate-700 text-base"
              required minLength={SECURITY_PASSWORD_MIN_LENGTH}
            />
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              placeholder="Confirm new password"
              className="flex-1 min-h-[44px] px-3 rounded-xl bg-slate-900 border border-slate-700 text-base"
              required minLength={SECURITY_PASSWORD_MIN_LENGTH}
            />
            <button type="submit" className="min-h-[44px] px-4 rounded-xl bg-brand-600 font-semibold text-sm text-slate-950">
              Update
            </button>
          </div>
          {pwMsg && <p className="text-xs text-slate-300">{pwMsg}</p>}
        </form>
      )}

      <main className="flex-1 w-full max-w-xl mx-auto px-4 py-4 space-y-4 overflow-y-auto">
        {!result ? (
          <>
            <div className="flex rounded-2xl bg-slate-900 border border-slate-800 p-1 gap-1">
              <button
                onClick={() => { setActiveTab('camera'); setCameraError(null); }}
                className={`flex-1 min-h-[48px] flex items-center justify-center gap-2 rounded-xl text-sm font-semibold ${activeTab === 'camera' ? 'bg-brand-600 text-slate-950' : 'text-slate-300'}`}
              >
                <Camera className="w-5 h-5" /> Camera
              </button>
              <button
                onClick={() => { setActiveTab('manual'); setCameraError(null); }}
                className={`flex-1 min-h-[48px] flex items-center justify-center gap-2 rounded-xl text-sm font-semibold ${activeTab === 'manual' ? 'bg-brand-600 text-slate-950' : 'text-slate-300'}`}
              >
                <Keyboard className="w-5 h-5" /> Manual entry
              </button>
            </div>

            {cameraError && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/40 rounded-xl text-amber-200 text-sm flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span>{cameraError}</span>
              </div>
            )}

            {activeTab === 'camera' ? (
              <div className="space-y-2">
                <div id="gate-scanner-reader" className="rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 min-h-[300px]" />
                <p className="text-xs text-slate-400 text-center px-2">
                  Point the camera at the resident QR pass. If the camera does not start, allow camera
                  permission in the browser, or switch to Manual entry.
                </p>
              </div>
            ) : (
              <form
                onSubmit={(e) => { e.preventDefault(); verify(manualToken, 'MANUAL_ENTRY'); }}
                className="space-y-3"
              >
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Credential token or QR link
                </label>
                <input
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  placeholder="Paste HOSTEL-ID-PASS token or full QR link"
                  className="w-full min-h-[48px] px-4 rounded-xl bg-slate-900 border border-slate-700 text-base"
                  required
                />
                <button
                  type="submit"
                  disabled={isVerifying || !manualToken.trim()}
                  className="w-full min-h-[52px] rounded-2xl bg-brand-600 text-slate-950 font-bold text-base disabled:opacity-50"
                >
                  {isVerifying ? 'Verifying…' : 'Verify resident'}
                </button>
              </form>
            )}
            {isVerifying && <p className="text-center text-sm text-slate-300">Verifying with hostel records…</p>}
          </>
        ) : (
          <div className="space-y-4">
            <div
              className={`p-5 rounded-2xl border text-center ${
                status === 'VALID_RESIDENT' ? 'bg-emerald-500/10 border-emerald-500/50'
                : status === 'ATTENTION_REQUIRED' ? 'bg-amber-500/10 border-amber-500/50'
                : 'bg-rose-500/10 border-rose-500/50'
              }`}
            >
              {status === 'VALID_RESIDENT' ? (
                <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-400" />
              ) : status === 'ATTENTION_REQUIRED' ? (
                <AlertTriangle className="w-12 h-12 mx-auto text-amber-400" />
              ) : (
                <XCircle className="w-12 h-12 mx-auto text-rose-400" />
              )}
              <h2 className="mt-2 text-xl font-bold">
                {status === 'VALID_RESIDENT' ? 'VALID RESIDENT'
                  : status === 'ATTENTION_REQUIRED' ? 'ATTENTION REQUIRED'
                  : status === 'EXPIRED' ? 'EXPIRED PASS' : 'INVALID CREDENTIAL'}
              </h2>
              <p className="mt-1 text-sm text-slate-300 break-words">{result.reason}</p>
            </div>

            {status === 'VALID_RESIDENT' && (
              <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-3">
                {photoLoading ? (
                  <div className="mx-auto flex h-52 w-52 items-center justify-center rounded-2xl border border-slate-700 bg-slate-800">
                    <p className="px-4 text-center text-xs text-slate-300">Loading approved photograph…</p>
                  </div>
                ) : photoSrc ? (
                  <img src={photoSrc} alt="Approved resident photograph" className="mx-auto h-52 w-52 rounded-2xl object-cover border-2 border-emerald-500" />
                ) : (
                  <p className="text-center text-xs text-amber-200 bg-amber-500/10 border border-amber-500/40 rounded-xl p-3">
                    {result.photo_display === 'WITHHELD'
                      ? (result.photo_display_reason || 'No approved photograph available.')
                      : 'Photograph unavailable.'} Continue with name, facility and room below.
                  </p>
                )}
                <div className="text-center">
                  <p className="text-lg font-bold break-words">{result.student?.full_name}</p>
                  <p className="text-sm text-slate-300 break-words">
                    {result.hostel?.name} · Room {result.room?.room_number || '—'}
                  </p>
                  <p className="text-xs text-slate-400 break-words">
                    {result.student?.department} ({result.student?.academic_level}) ·{' '}
                    {result.allocation?.start_date} to {result.allocation?.end_date}
                  </p>
                </div>
              </div>
            )}

            <button
              onClick={scanNext}
              className="w-full min-h-[52px] flex items-center justify-center gap-2 rounded-2xl bg-slate-100 text-slate-950 font-bold text-base"
            >
              <RefreshCw className="w-5 h-5" /> Scan next resident
            </button>
          </div>
        )}
      </main>
    </div>
  );
};
