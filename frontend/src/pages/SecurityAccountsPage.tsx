import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { SECURITY_PASSWORD_MIN_LENGTH } from '@hostel/shared';
import { ShieldPlus, UserPlus, Ban, CheckCircle2, AlertTriangle } from 'lucide-react';

export const SecurityAccountsPage: React.FC = () => {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const res = await api.listSecurityAccounts();
      setAccounts(res.accounts);
    } catch (err: any) {
      setMsg({ kind: 'err', text: err.message || 'Could not load staff accounts.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await api.createSecurityAccount({ username: username.trim(), password, full_name: fullName.trim() });
      setMsg({ kind: 'ok', text: `Security account “${username.trim()}” created. Share the login name and password with the officer directly.` });
      setUsername('');
      setPassword('');
      setFullName('');
      await load();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err.message || 'Could not create the account.' });
    }
  };

  const toggle = async (id: string, is_active: boolean, name: string) => {
    const verb = is_active ? 'deactivate' : 'reactivate';
    if (!window.confirm(`Are you sure you want to ${verb} the security account “${name}”?`)) return;
    try {
      await api.setSecurityAccountActive(id, is_active);
      await load();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err.message || 'Could not update the account.' });
    }
  };

  const security = accounts.filter((a) => a.role === 'SECURITY');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Security Accounts</h2>
        <p className="text-xs text-slate-500 mt-1">
          Individual gate-scanner logins for security staff. Each officer gets a unique login; there are no shared passwords. Deactivated accounts lose access immediately.
        </p>
      </div>

      {msg && (
        <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${msg.kind === 'ok' ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-rose-50 border border-rose-200 text-rose-700'}`}>
          {msg.kind === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span className="break-words">{msg.text}</span>
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
        <h3 className="font-bold text-sm flex items-center gap-2"><UserPlus className="w-4 h-4" /> Create security login</h3>
        <form onSubmit={create} className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Login name</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. gate.north"
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 text-base sm:text-sm" required minLength={3} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Officer name</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Adaeze Okafor"
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 text-base sm:text-sm" required minLength={2} />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-slate-600 mb-1">Temporary password (12+ characters — officer changes it after sign-in)</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Strong temporary password"
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 text-base sm:text-sm" required minLength={SECURITY_PASSWORD_MIN_LENGTH} />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-2 px-5 rounded-xl bg-slate-900 text-white text-sm font-semibold">
              <ShieldPlus className="w-4 h-4" /> Create security account
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b p-4 font-bold text-sm">Gate scanner logins ({security.length})</div>
        {loading ? (
          <p className="p-6 text-sm text-slate-500">Loading…</p>
        ) : security.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No security accounts yet. Create one above for each gate officer.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[520px]">
              <thead className="bg-slate-50 text-slate-500">
                <tr><th className="p-3">Officer</th><th className="p-3">Login</th><th className="p-3">Status</th><th className="p-3 text-right">Action</th></tr>
              </thead>
              <tbody>
                {security.map((a) => (
                  <tr key={a.id} className="border-t">
                    <td className="p-3 font-semibold break-words">{a.full_name}</td>
                    <td className="p-3 font-mono break-all">{a.username}</td>
                    <td className="p-3">{a.is_active ? <span className="text-emerald-700 font-semibold">Active</span> : <span className="text-rose-600 font-semibold">Deactivated</span>}</td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => toggle(a.id, !!a.is_active, a.username)}
                        className={`min-h-[44px] px-3 rounded-lg font-semibold ${a.is_active ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}
                      >
                        {a.is_active ? <span className="inline-flex items-center gap-1"><Ban className="w-3.5 h-3.5" /> Deactivate</span> : 'Reactivate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
