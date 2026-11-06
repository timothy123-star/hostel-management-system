import React, { useEffect, useMemo, useState } from 'react';
import { Camera, QrCode, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { api } from '../api/client.js';
import { Modal } from '../components/Modal.js';
import { QRScannerModal } from '../components/QRScannerModal.js';
import { StatusBadge } from '../components/StatusBadge.js';

const facilityName = (code?: string) => code === 'MALE' ? 'Male hostel' : code === 'FEMALE' ? 'Female hostel' : 'No facility';
const formatDate = (value?: string) => value ? new Date(value).toLocaleDateString() : '—';

function eligibility(student: any) {
  const allocation = student?.current_allocation;
  const reasons: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  if (!allocation || allocation.status !== 'FINALIZED') reasons.push('No current finalized accommodation');
  if (student?.payment?.status !== 'VERIFIED') reasons.push('Individual payment is not verified');
  if (student?.photo_status !== 'APPROVED') reasons.push('Current photograph is not approved');
  if (allocation?.accommodation_start_date > today) reasons.push(`Accommodation starts ${allocation.accommodation_start_date}`);
  if (allocation?.accommodation_end_date < today) reasons.push(`Accommodation expired ${allocation.accommodation_end_date}`);
  return { eligible: reasons.length === 0, reasons };
}

export const QRIdentityPage: React.FC = () => {
  const [credentials, setCredentials] = useState<any[]>([]); const [logs, setLogs] = useState<any[]>([]);
  const [query, setQuery] = useState(''); const [results, setResults] = useState<any[]>([]); const [selected, setSelected] = useState<any | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false); const [issued, setIssued] = useState<any | null>(null); const [revoking, setRevoking] = useState<any | null>(null);
  const [reason, setReason] = useState(''); const [working, setWorking] = useState(false);
  const selectedEligibility = useMemo(() => eligibility(selected), [selected]);
  const selectedActiveCredential = selected && credentials.find(c => c.student_id === selected.id && c.status === 'ACTIVE');
  const load = async () => { const [c, l] = await Promise.all([api.getQRCredentials(), api.getAccessLogs()]); setCredentials(c.credentials); setLogs(l.accessLogs); };
  useEffect(() => { load().catch(console.error); }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => api.getStudents({ search: query, limit: 20 }).then(r => setResults(r.students)).catch(console.error), 180);
    return () => window.clearTimeout(timer);
  }, [query]);
  const issue = async (reissue = false) => {
    if (!selected) return; setWorking(true);
    try { setIssued(await api.issueQRCredential(selected.id, reissue)); await load(); }
    catch (e: any) { alert(e.message || 'Credential issuance failed. The server rechecked eligibility.'); }
    finally { setWorking(false); }
  };
  const revoke = async () => {
    if (!revoking || reason.trim().length < 3) return; setWorking(true);
    try { await api.revokeQR(revoking.id, reason.trim()); setRevoking(null); setReason(''); await load(); }
    catch (e: any) { alert(e.message || 'Credential revocation failed.'); }
    finally { setWorking(false); }
  };
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-2xl font-bold text-slate-900">Resident QR credentials</h2><p className="mt-1 text-xs text-slate-500">Manager-authorized credentials with opaque verification URLs.</p></div><button onClick={() => setScannerOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-xs font-semibold text-slate-950"><Camera className="w-4 h-4" />Gate scanner</button></div>
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-xs text-slate-200"><ShieldCheck className="mr-2 inline w-5 text-brand-400" />The manager selector is informational only. The backend independently enforces allocation, payment, photo, and accommodation-date eligibility at issuance.</div>
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-bold text-slate-900">Select resident for credential issuance</h3><p className="mt-1 text-xs text-slate-500">Search by name, phone, or department. Internal IDs are never shown or entered manually.</p><div className="relative mt-3"><Search className="absolute left-3 top-2.5 w-4 text-slate-400" /><input value={query} onChange={e => { setQuery(e.target.value); setSelected(null); }} placeholder="Search residents" className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm" /></div><div className="mt-2 max-h-64 overflow-auto rounded-xl border border-slate-100">{results.map(student => { const state = eligibility(student); return <button key={student.id} onClick={() => { setSelected(student); setQuery(student.full_name); }} className={`block w-full border-b p-3 text-left text-xs hover:bg-slate-50 ${selected?.id === student.id ? 'bg-brand-50' : ''}`}><div className="flex flex-wrap justify-between gap-2"><span className="font-semibold text-slate-900">{student.full_name}</span><span className={state.eligible ? 'text-emerald-700' : 'text-amber-700'}>{state.eligible ? 'Eligible' : 'Not yet eligible'}</span></div><div className="mt-1 text-slate-500">{student.phone_number} · {facilityName(student.current_allocation?.hostel_code)} · Room {student.current_allocation?.room_number || '—'}</div></button>; })}{results.length === 0 && <p className="p-3 text-xs text-slate-500">No matching residents.</p>}</div>
      {selected && <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-bold text-slate-900">{selected.full_name}</p><p className="text-xs text-slate-500">{selected.phone_number} · {facilityName(selected.current_allocation?.hostel_code)} · Room {selected.current_allocation?.room_number || '—'}</p></div><StatusBadge status={selectedEligibility.eligible ? 'VERIFIED' : 'PENDING'} size="sm" /></div><div className="mt-3 grid gap-2 text-xs md:grid-cols-3"><p><span className="text-slate-500">Payment:</span> {selected.payment?.status || 'NOT FOUND'}</p><p><span className="text-slate-500">Photograph:</span> {selected.photo_status || 'NOT SUBMITTED'}</p><p><span className="text-slate-500">Accommodation:</span> {formatDate(selected.current_allocation?.accommodation_start_date)} – {formatDate(selected.current_allocation?.accommodation_end_date)}</p></div>{selectedEligibility.eligible ? <p className="mt-3 text-xs text-emerald-700">All visible requirements are met. The backend will revalidate before issuing.</p> : <ul className="mt-3 list-disc pl-4 text-xs text-amber-800">{selectedEligibility.reasons.map(item => <li key={item}>{item}</li>)}</ul>}<div className="mt-4 flex flex-wrap gap-2"><button disabled={working || !selectedEligibility.eligible || !!selectedActiveCredential} onClick={() => issue(false)} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Issue credential</button>{selectedActiveCredential && <button disabled={working || !selectedEligibility.eligible} onClick={() => issue(true)} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-50">Reissue active credential</button>}</div></div>}</section>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="flex items-center justify-between border-b p-4"><h3 className="font-bold text-sm"><QrCode className="mr-2 inline w-4" />Credential history</h3><button onClick={() => load()} className="text-slate-500"><RefreshCw className="w-4" /></button></div><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="p-3">Resident</th><th className="p-3">Current room</th><th className="p-3">Status</th><th className="p-3">Issued</th><th className="p-3 text-right">Action</th></tr></thead><tbody>{credentials.map(c => <tr key={c.id} className="border-t"><td className="p-3 font-semibold">{c.student_name}<div className="font-normal text-slate-500">{c.phone_number}</div></td><td className="p-3">{c.hostel_name || '—'} · {c.room_number || '—'}</td><td className="p-3"><StatusBadge status={c.status} size="sm" /><div className="mt-1 text-rose-600">{c.revoke_reason}</div></td><td className="p-3">{new Date(c.issued_at).toLocaleString()}</td><td className="p-3 text-right">{c.status === 'ACTIVE' && <button onClick={() => { setRevoking(c); setReason(''); }} className="rounded-lg bg-rose-50 px-2 py-1 font-semibold text-rose-700">Revoke</button>}</td></tr>)}</tbody></table></div></section>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="border-b p-4 font-bold text-sm">Verification audit</div><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="p-3">Time</th><th className="p-3">Resident</th><th className="p-3">Channel</th><th className="p-3">Outcome</th><th className="p-3">Reason</th></tr></thead><tbody>{logs.map(log => <tr key={log.id} className="border-t"><td className="p-3">{new Date(log.logged_at).toLocaleString()}</td><td className="p-3">{log.student_name || 'Unknown'}</td><td className="p-3">{log.verification_channel}</td><td className="p-3"><StatusBadge status={log.outcome} size="sm" /></td><td className="p-3">{log.reason}</td></tr>)}</tbody></table></div></section>
    <Modal isOpen={!!issued} onClose={() => setIssued(null)} title="Credential issued" maxWidth="sm">{issued && <div className="space-y-4 text-center"><img src={issued.qrImageData} alt="Resident verification QR code" className="mx-auto w-56 rounded-xl border p-2" /><p className="text-xs text-slate-600">Display or securely hand this QR to the resident now. It cannot be regenerated without an explicit reissue.</p></div>}</Modal>
    <Modal isOpen={!!revoking} onClose={() => setRevoking(null)} title="Revoke credential" maxWidth="sm"><div className="space-y-3"><p className="text-xs text-slate-600">A reason is recorded in the credential and audit history.</p><input value={reason} onChange={e => setReason(e.target.value)} placeholder="Documented reason" className="w-full rounded-xl border p-2 text-sm" /><button disabled={working || reason.trim().length < 3} onClick={revoke} className="w-full rounded-xl bg-rose-600 p-2 text-xs font-semibold text-white disabled:opacity-50">Confirm revocation</button></div></Modal>
    <QRScannerModal isOpen={scannerOpen} onClose={() => setScannerOpen(false)} onVerificationComplete={() => load()} />
  </div>;
};
