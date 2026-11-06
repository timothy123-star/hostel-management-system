import React, { useEffect, useState } from 'react';

export const ResidentVerificationPage: React.FC<{ token: string }> = ({ token }) => {
  const [result, setResult] = useState<any | null>(null);
  useEffect(() => {
    fetch(`/api/qr/public/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async response => ({ ok: response.ok, body: await response.json() }))
      .then(({ body }) => setResult(body)).catch(() => setResult({ status: 'INVALID_CREDENTIAL', reason: 'Verification is unavailable.' }));
  }, [token]);
  if (!result) return <main className="mx-auto max-w-md p-8 text-center text-slate-600">Verifying resident credential…</main>;
  const valid = result.status === 'VALID_RESIDENT';
  return <main className="mx-auto min-h-screen max-w-md bg-slate-50 p-6"><section className={`mt-12 rounded-3xl border p-6 text-center shadow-sm ${valid ? 'border-emerald-200 bg-white' : 'border-rose-200 bg-white'}`}><p className="text-xs font-bold tracking-widest text-brand-600">HOSTELOS</p><h1 className={`mt-3 text-2xl font-bold ${valid ? 'text-emerald-700' : 'text-rose-700'}`}>{valid ? 'VALID RESIDENT' : 'INVALID CREDENTIAL'}</h1><p className="mt-2 text-sm text-slate-600">{result.reason}</p>{valid && <><img src={result.photo_url} alt="Approved resident photograph" className="mx-auto mt-6 h-40 w-40 rounded-2xl object-cover" /><h2 className="mt-4 text-xl font-bold text-slate-900">{result.student.full_name}</h2><dl className="mt-5 space-y-2 text-sm text-slate-700"><div><dt className="text-xs text-slate-500">Facility</dt><dd>{result.hostel.name}</dd></div><div><dt className="text-xs text-slate-500">Current room</dt><dd>{result.room.room_number}</dd></div><div><dt className="text-xs text-slate-500">Accommodation validity</dt><dd>{result.allocation.start_date} – {result.allocation.end_date}</dd></div></dl></>}</section></main>;
};
