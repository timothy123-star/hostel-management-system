import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { api } from '../api/client.js';
import { SECURITY_PASSWORD_MIN_LENGTH } from '@hostel/shared';
import { KeyRound, LogOut, AlertCircle } from 'lucide-react';

export const ForcePasswordChangePage: React.FC<{ onDone: (path: string) => void }> = ({ onDone }) => {
  const { user, logout, refresh } = useAuth();
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPw !== confirmPw) {
      setError('The new passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(currentPw, newPw, confirmPw);
      await refresh();
      // A deep-linked resident verification interrupted by the mandatory
      // password change resumes there instead of dropping to the scanner.
      try {
        const pendingScan = sessionStorage.getItem('hostel_pending_scan');
        if (pendingScan) {
          sessionStorage.removeItem('hostel_pending_scan');
          onDone(`/resident-verification/${encodeURIComponent(pendingScan)}`);
          return;
        }
      } catch { /* storage unavailable */ }
      onDone('/security/scan');
    } catch (err: any) {
      if (err?.details?.code === 'PASSWORD_CHANGE_REQUIRED' || err.status === 403) {
        setError(err.message || 'Password change is still required.');
      } else {
        setError(err.message || 'Password change failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-slate-950 text-white p-4">
      <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-brand-600 flex items-center justify-center shrink-0">
            <KeyRound className="w-6 h-6 text-slate-950" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold">Change your password</h1>
            <p className="text-xs text-slate-400 truncate">{user?.full_name || user?.username || 'Security staff'}</p>
          </div>
        </div>
        <p className="mt-3 text-sm text-slate-300">
          You signed in with a temporary password. You must set your own password before you can use the gate scanner.
        </p>
        {error && (
          <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-200 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}
        <form onSubmit={submit} className="mt-4 space-y-3">
          <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)}
            placeholder="Temporary password" autoComplete="current-password"
            className="w-full min-h-[48px] px-4 rounded-xl bg-slate-950 border border-slate-700 text-base" required />
          <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)}
            placeholder="New password (12+ characters)" autoComplete="new-password"
            className="w-full min-h-[48px] px-4 rounded-xl bg-slate-950 border border-slate-700 text-base" required minLength={SECURITY_PASSWORD_MIN_LENGTH} />
          <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)}
            placeholder="Confirm new password" autoComplete="new-password"
            className="w-full min-h-[48px] px-4 rounded-xl bg-slate-950 border border-slate-700 text-base" required minLength={SECURITY_PASSWORD_MIN_LENGTH} />
          <button type="submit" disabled={busy}
            className="w-full min-h-[52px] rounded-2xl bg-brand-600 text-slate-950 font-bold text-base disabled:opacity-50">
            {busy ? 'Updating…' : 'Set password and continue'}
          </button>
        </form>
        <button onClick={logout}
          className="mt-3 w-full min-h-[48px] flex items-center justify-center gap-2 rounded-2xl bg-slate-800 text-sm font-semibold text-slate-200">
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      </div>
    </div>
  );
};
