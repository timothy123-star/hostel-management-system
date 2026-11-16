import React, { useEffect, useState } from 'react';

type LoadState =
  | { kind: 'checking' }
  | { kind: 'restricted'; reason: string }
  | { kind: 'failed'; reason: string }
  | { kind: 'ready'; result: any; photoSrc: string | null };

/**
 * Staff-only QR identity check. Resident details and the approved photograph
 * are only fetched with an authenticated staff session; without one, nothing
 * about the resident is retrieved or displayed.
 */
export const ResidentVerificationPage: React.FC<{ token: string }> = ({ token }) => {
  const [state, setState] = useState<LoadState>({ kind: 'checking' });

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const adminToken = localStorage.getItem('hostel_admin_token');
    if (!adminToken) {
      try { sessionStorage.setItem('hostel_pending_scan', token); } catch { /* private mode */ }
      setState({ kind: 'restricted', reason: 'Authorized staff sign-in is required before resident details can be shown.' });
      return;
    }
    try { sessionStorage.removeItem('hostel_pending_scan'); } catch { /* private mode */ }
    (async () => {
      try {
        const response = await fetch(`/api/qr/staff/${encodeURIComponent(token)}`, {
          headers: { Authorization: `Bearer ${adminToken}` },
          cache: 'no-store'
        });
        if (response.status === 401 || response.status === 403) {
          if (!cancelled) setState({ kind: 'restricted', reason: 'Your staff session is missing or expired. Please sign in again to verify this resident.' });
          return;
        }
        const body = await response.json();
        let photoSrc: string | null = null;
        if (body.status === 'VALID_RESIDENT' && body.photo_display === 'CONSENTED' && body.photo_url) {
          const photoResponse = await fetch(body.photo_url, {
            headers: { Authorization: `Bearer ${adminToken}` },
            cache: 'no-store'
          });
          if (photoResponse.ok) {
            objectUrl = URL.createObjectURL(await photoResponse.blob());
            photoSrc = objectUrl;
          }
        }
        if (!cancelled) setState({ kind: 'ready', result: body, photoSrc });
      } catch {
        if (!cancelled) setState({ kind: 'failed', reason: 'Verification is unavailable. Please try again.' });
      }
    })();
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [token]);

  if (state.kind === 'checking') return <main className="mx-auto max-w-md p-8 text-center text-slate-600">Verifying resident credential…</main>;
  if (state.kind === 'restricted') return <main className="mx-auto min-h-screen max-w-md bg-slate-50 p-6"><section className="mt-12 rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm"><p className="text-xs font-bold tracking-widest text-brand-600">HOSTELOS</p><h1 className="mt-3 text-2xl font-bold text-slate-900">Restricted</h1><p className="mt-2 text-sm text-slate-600">{state.reason} No resident information was retrieved.</p><a href="/login" className="mt-4 inline-block rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Staff sign-in</a></section></main>;
  if (state.kind === 'failed') return <main className="mx-auto max-w-md p-8 text-center text-slate-600">{state.reason}</main>;
  const { result, photoSrc } = state;
  const valid = result.status === 'VALID_RESIDENT';
  const showPhoto = valid && result.photo_display === 'CONSENTED' && photoSrc;
  const withheldReason = valid && result.photo_display === 'WITHHELD' ? (result.photo_display_reason || 'An approved photograph is unavailable or display permission is not granted.') : null;
  const isExpired = !valid && /expired/i.test(result.reason || '');
  const stateLabel = valid ? 'VALID RESIDENT' : isExpired ? 'EXPIRED PASS' : result.status === 'INVALID_CREDENTIAL' && /not active/i.test(result.reason || '') ? 'REVOKED OR INACTIVE PASS' : 'INVALID CREDENTIAL';
  return <main className="mx-auto min-h-screen max-w-md bg-slate-50 p-6"><section className={`mt-12 rounded-3xl border p-6 text-center shadow-sm ${valid ? 'border-emerald-200 bg-white' : 'border-rose-200 bg-white'}`}><p className="text-xs font-bold tracking-widest text-brand-600">HOSTELOS</p><h1 className={`mt-3 text-2xl font-bold ${valid ? 'text-emerald-700' : 'text-rose-700'}`}>{stateLabel}</h1><p className="mt-2 text-sm text-slate-600">{result.reason}</p>{valid && (<>{showPhoto ? (<figure className="mt-6"><img src={photoSrc as string} alt="Approved resident photograph for identity comparison" className="mx-auto h-44 w-44 rounded-2xl border-2 border-emerald-500 object-cover" /><figcaption className="mx-auto mt-3 max-w-xs rounded-xl bg-emerald-50 p-2 text-xs font-medium text-emerald-800">Gate staff: compare this approved photograph with the person present, plus name, facility and room below.</figcaption></figure>) : (<p className="mx-auto mt-6 max-w-xs rounded-xl bg-amber-50 p-3 text-xs font-medium text-amber-900">{withheldReason} Verification continues with name, facility, room and dates below; ask management if a photo check is required.</p>)}<h2 className="mt-4 text-xl font-bold text-slate-900">{result.student.full_name}</h2><dl className="mt-5 space-y-2 text-sm text-slate-700"><div><dt className="text-xs text-slate-500">Facility</dt><dd>{result.hostel.name}</dd></div><div><dt className="text-xs text-slate-500">Final allocated room</dt><dd>{result.room.room_number}</dd></div><div><dt className="text-xs text-slate-500">Pass validity</dt><dd>{result.allocation.start_date} – {result.allocation.end_date}</dd></div><div><dt className="text-xs text-slate-500">Pass status</dt><dd>ACTIVE — verified</dd></div></dl></>)}</section><p className="mt-4 text-center text-[11px] text-slate-400">Authorized staff only. No phone numbers or private contact details are displayed. Photographs appear only after the resident's upload permission and manager approval.</p></main>;
};
