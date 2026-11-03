import React, { useEffect, useState } from 'react';

export const StudentPhotoUploadPage: React.FC<{ token: string }> = ({ token }) => {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [message, setMessage] = useState('Checking your secure upload link…');
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/student-photo-upload/${encodeURIComponent(token)}`)
      .then(async response => {
        if (!response.ok) throw new Error((await response.json()).error);
        setReady(true);
        setMessage('Take or choose a clear photograph, then review it before submitting.');
      })
      .catch(error => setMessage(error.message || 'This upload link is unavailable.'));
  }, [token]);

  const chooseFile = (selected?: File) => {
    if (!selected) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(selected.type)) {
      setMessage('Please choose a JPEG, PNG, or WebP image.'); return;
    }
    if (selected.size > 5 * 1024 * 1024) { setMessage('The photograph must be 5 MB or smaller.'); return; }
    if (preview) URL.revokeObjectURL(preview);
    setFile(selected); setPreview(URL.createObjectURL(selected)); setMessage('Preview ready. You can replace it before submitting.');
  };

  const submit = async () => {
    if (!file) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/student-photo-upload/${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setReady(false); setMessage('Photograph submitted successfully. It is pending management review.');
    } catch (error: any) { setMessage(error.message || 'Upload failed. Please try again.'); }
    finally { setSubmitting(false); }
  };

  return <main className="min-h-screen bg-slate-100 px-4 py-10 flex items-center justify-center">
    <section className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm border border-slate-200 space-y-5">
      <div><p className="text-xs font-bold tracking-widest text-brand-600">HOSTELOS</p><h1 className="text-2xl font-bold text-slate-900 mt-1">Submit your photograph</h1></div>
      <p className="text-sm text-slate-600" role="status">{message}</p>
      {ready && <>
        {preview && <img src={preview} alt="Selected photograph preview" className="w-full aspect-square rounded-xl object-cover bg-slate-100" />}
        <label className="block text-center cursor-pointer rounded-xl border-2 border-dashed border-slate-300 px-4 py-5 text-sm font-semibold text-slate-700 hover:border-brand-500">
          {preview ? 'Replace photograph' : 'Take photo or choose from gallery'}
          <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="user" onChange={e => chooseFile(e.target.files?.[0])} />
        </label>
        <button disabled={!file || submitting} onClick={submit} className="w-full rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white disabled:opacity-50">
          {submitting ? 'Uploading…' : 'Submit photograph'}
        </button>
      </>}
    </section>
  </main>;
};
