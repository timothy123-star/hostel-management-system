import React, { useEffect, useState } from 'react';
import { Camera, Check, Eye, RefreshCw, X } from 'lucide-react';
import { api } from '../api/client.js';
import { Modal } from '../components/Modal.js';
import { StatusBadge } from '../components/StatusBadge.js';

export const PhotoReviewsPage: React.FC = () => {
  const [status, setStatus] = useState('PENDING_REVIEW');
  const [reviews, setReviews] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [consent, setConsent] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const load = async () => { try { setReviews((await api.getPhotoReviews(status)).reviews); } catch (e) { console.error(e); } };
  useEffect(() => { load(); }, [status]);
  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, [imageUrl]);

  const open = async (review: any) => {
    setSelected(review); setError(null); setReason(''); setImageUrl(null); setConsent(null);
    try {
      const [historyResult, photoResponse] = await Promise.all([
        api.getPhotoReviewHistory(review.student_id),
        fetch(`/api/photo-reviews/${encodeURIComponent(review.student_id)}/image?submission_id=${encodeURIComponent(review.submission_id)}`, { headers: { Authorization: `Bearer ${localStorage.getItem('hostel_admin_token')}` } })
      ]);
      if (!photoResponse.ok) throw new Error((await photoResponse.json()).error);
      setHistory(historyResult.history); setImageUrl(URL.createObjectURL(await photoResponse.blob()));
      try { setConsent((await api.getPhotoDisplayConsent(review.student_id)).consent); } catch { setConsent(null); }
    } catch (e: any) { setError(e.message || 'Unable to load the private photograph.'); }
  };

  const decide = async (decision: 'APPROVED' | 'REJECTED') => {
    if (!selected || (decision === 'REJECTED' && !reason.trim())) { setError('A rejection reason is required.'); return; }
    setWorking(true); setError(null);
    try {
      if (decision === 'APPROVED') await api.approvePhoto(selected.student_id, selected.submission_id); else await api.rejectPhoto(selected.student_id, reason.trim(), selected.submission_id);
      setSelected(null); await load();
    } catch (e: any) { setError(e.message || 'Unable to record the review.'); } finally { setWorking(false); }
  };

  const replacement = async () => {
    if (!selected) return; setWorking(true); setError(null);
    try { await api.requestReplacementPhoto(selected.student_id); setError('Replacement upload link sent through the WhatsApp simulator.'); }
    catch (e: any) { setError(e.message || 'Unable to authorize a replacement.'); } finally { setWorking(false); }
  };

  return <div className="space-y-6">
    <div><h2 className="text-2xl font-bold text-slate-900">Photograph Reviews</h2><p className="text-xs text-slate-500 mt-1">Review private resident photographs and retain each submission decision.</p></div>
    <div className="flex gap-2"><select value={status} onChange={e => setStatus(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium"><option value="PENDING_REVIEW">Pending review</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option></select><button onClick={load} className="rounded-xl bg-slate-100 px-3 text-slate-700"><RefreshCw className="w-4 h-4" /></button></div>
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500 uppercase"><tr><th className="p-3">Student</th><th className="p-3">Facility / room</th><th className="p-3">Submitted</th><th className="p-3">Status</th><th className="p-3"></th></tr></thead><tbody>{reviews.map(review => <tr key={review.submission_id} className="border-t"><td className="p-3"><p className="font-bold text-slate-900">{review.full_name}</p><p className="text-slate-500">{review.phone_number} · {review.department} · {review.academic_level}</p></td><td className="p-3">{review.gender === 'MALE' ? 'Male' : 'Female'} hostel<br />{review.room_number ? `Room ${review.room_number}` : 'No active room'}</td><td className="p-3">{new Date(review.submitted_at).toLocaleString()}</td><td className="p-3"><StatusBadge status={review.photo_status} size="sm" /></td><td className="p-3 text-right"><button onClick={() => open(review)} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-1.5 font-semibold text-slate-800"><Eye className="w-3.5 h-3.5" /> Review</button></td></tr>)}</tbody></table>{reviews.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No photographs match this filter.</p>}</div>
    <Modal isOpen={!!selected} onClose={() => setSelected(null)} title={selected ? `Photograph review — ${selected.full_name}` : 'Photograph review'} maxWidth="xl">
      {selected && <div className="space-y-4"><div className="grid gap-4 md:grid-cols-2"><div className="rounded-xl bg-slate-100 overflow-hidden min-h-48 flex items-center justify-center">{imageUrl ? <img src={imageUrl} alt={`Private submission from ${selected.full_name}`} className="max-h-[420px] w-full object-contain" /> : <Camera className="w-8 h-8 text-slate-400" />}</div><div className="space-y-2 text-sm"><p><strong>Student:</strong> {selected.full_name}</p><p><strong>Facility:</strong> {selected.gender} · {selected.room_number ? `Room ${selected.room_number}` : 'No room'}</p><p><strong>Submitted:</strong> {new Date(selected.submitted_at).toLocaleString()}</p><p><strong>Status:</strong> <StatusBadge status={selected.photo_status} size="sm" /></p></div></div>
        {error && <p className={`rounded-lg p-2 text-xs ${error.includes('sent through') ? 'bg-sky-50 text-sky-800' : 'bg-rose-50 text-rose-800'}`}>{error}</p>}
        {selected.photo_status === 'PENDING_REVIEW' && <><textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Rejection reason (required only if rejecting)" className="w-full rounded-xl border border-slate-200 p-3 text-sm" /><div className="flex justify-end gap-2"><button disabled={working} onClick={() => decide('REJECTED')} className="inline-flex items-center gap-1 rounded-xl bg-rose-600 px-3 py-2 text-xs font-semibold text-white"><X className="w-4 h-4" /> Reject</button><button disabled={working} onClick={() => decide('APPROVED')} className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"><Check className="w-4 h-4" /> Approve</button></div></>}
        {selected.photo_status === 'REJECTED' && <button disabled={working} onClick={replacement} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white">Authorize replacement link</button>}
        <div className="rounded-xl border border-slate-200 p-3 text-xs"><h4 className="font-bold text-sm text-slate-900 mb-1">QR photo-display permission</h4><p className="text-slate-500">Granted automatically when the resident uploads a photograph after the upload disclosure — there is no separate consent step. The photo appears on scans only when permission is GRANTED, the pass is ACTIVE and within validity, and the current photo is APPROVED. Use Withdraw to immediately hide the photo (takedown).</p><p className="mt-1">Current: <strong>{consent ? `${consent.decision}${consent.decidedAt ? ` (${new Date(consent.decidedAt).toLocaleString()})` : ''}` : 'NONE — withheld'}</strong></p><div className="mt-2 flex gap-2"><button disabled={working} onClick={async () => { if (!selected) return; const r = window.prompt('Withdrawal reason (recorded in audit)'); if (!r) return; setWorking(true); try { setConsent((await api.withdrawPhotoDisplayConsent(selected.student_id, r)).consent); } catch (e: any) { setError(e.message); } finally { setWorking(false); } }} className="rounded-lg bg-slate-100 px-3 py-1.5 font-semibold">Withdraw</button></div></div>
        <div><h4 className="font-bold text-sm text-slate-900 mb-2">Review history</h4><div className="space-y-2">{history.map(item => <div key={item.id} className="rounded-lg border border-slate-100 bg-slate-50 p-2 text-xs"><strong>{item.status.replace(/_/g, ' ')}</strong> — submitted {new Date(item.submitted_at).toLocaleString()}{item.reviewed_at && <>; reviewed by {item.reviewer_name || 'manager'} on {new Date(item.reviewed_at).toLocaleString()}</>}{item.rejection_reason && <p className="mt-1 text-rose-700">Reason: {item.rejection_reason}</p>}</div>)}</div></div>
      </div>}
    </Modal>
  </div>;
};
