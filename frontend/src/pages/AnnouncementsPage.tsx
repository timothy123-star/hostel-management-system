import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { Announcement, AnnouncementAudience } from '@hostel/shared';
import { Megaphone, Send, Users, CheckCircle2, History, MessageSquare, Eye } from 'lucide-react';
import { StatusBadge } from '../components/StatusBadge.js';
import { Modal } from '../components/Modal.js';

export const AnnouncementsPage: React.FC = () => {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState<AnnouncementAudience>('ALL');
  const [preview, setPreview] = useState<{ previewText: string; totalRecipients: number; recipients: any[] } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<any | null>(null);

  const loadAnnouncements = async () => {
    setIsLoading(true);
    try {
      const res = await api.getAnnouncements();
      setAnnouncements(res.announcements);
    } catch (err) {
      console.error('Failed to load announcements:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAnnouncements();
  }, []);

  const handlePreview = async () => {
    if (!title.trim() || !message.trim()) return;
    try {
      const res = await api.previewAnnouncement({
        title: title.trim(),
        message: message.trim(),
        target_audience: audience
      });
      setPreview(res);
    } catch (err: any) {
      alert(err.message || 'Failed to preview announcement');
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !message.trim()) return;
    setIsSending(true);
    try {
      await api.sendAnnouncement({
        title: title.trim(),
        message: message.trim(),
        target_audience: audience
      });
      setTitle('');
      setMessage('');
      setPreview(null);
      await loadAnnouncements();
    } catch (err: any) {
      alert(err.message || 'Failed to dispatch announcement');
    } finally {
      setIsSending(false);
    }
  };

  const handleViewRecipients = async (announcementId: string) => {
    try {
      const res = await api.getAnnouncementById(announcementId);
      setSelectedAnnouncement(res.announcement);
    } catch (err) {
      alert('Failed to load delivery report');
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Bulk WhatsApp Announcements</h2>
        <p className="text-xs text-slate-500 mt-1">
          Compose, preview, and broadcast official hostel memos and urgent alerts directly to students' WhatsApp accounts.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Compose Form */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Megaphone className="w-5 h-5 text-slate-700" />
            <h3 className="font-bold text-sm text-slate-900">Compose New Broadcast</h3>
          </div>

          <form onSubmit={handleSend} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">Target Audience</label>
              <select
                value={audience}
                onChange={(e) => {
                  setAudience(e.target.value as any);
                  setPreview(null);
                }}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:ring-2 focus:ring-brand-500 focus:outline-none font-medium"
              >
                <option value="ALL">All Registered Students</option>
                <option value="MALE">Alpha Male Hall Only</option>
                <option value="FEMALE">Beta Female Hall Only</option>
                <option value="EXPIRING_SOON">Students Approaching Expiry (&le; 30 Days)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">Announcement Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setPreview(null);
                }}
                placeholder="e.g. Mandatory End-of-Semester Clearance Notice"
                className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">Message Body</label>
              <textarea
                rows={5}
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  setPreview(null);
                }}
                placeholder="Enter the official hostel notice content here..."
                className="w-full px-3.5 py-2.5 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none resize-none"
                required
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={handlePreview}
                disabled={!title.trim() || !message.trim()}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold transition disabled:opacity-50"
              >
                Preview Recipients & Formatting
              </button>

              <button
                type="submit"
                disabled={isSending || !title.trim() || !message.trim()}
                className="flex items-center gap-2 px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                {isSending ? 'Broadcasting...' : 'Broadcast Announcement'}
              </button>
            </div>
          </form>
        </div>

        {/* Live Preview Column */}
        <div className="lg:col-span-5 bg-slate-50 border border-slate-200 rounded-2xl p-6 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
              <h4 className="font-bold text-xs uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                <Eye className="w-4 h-4 text-slate-500" /> WhatsApp Live Preview
              </h4>
              {preview && (
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-brand-50 text-brand-700 border border-brand-200">
                  {preview.totalRecipients} Recipient(s)
                </span>
              )}
            </div>

            {preview ? (
              <div className="space-y-3">
                <div className="bg-white rounded-xl border border-slate-200 p-4 font-mono text-xs text-slate-800 shadow-sm whitespace-pre-line leading-relaxed">
                  {preview.previewText}
                </div>
                <div className="text-[11px] text-slate-500">
                  Targeted sample recipients: {preview.recipients.slice(0, 3).map(r => r.full_name).join(', ')}
                  {preview.totalRecipients > 3 && ` and ${preview.totalRecipients - 3} others.`}
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-slate-400 text-xs italic">
                Enter your title and message, then click "Preview Recipients & Formatting" to inspect the WhatsApp delivery preview.
              </div>
            )}
          </div>

          <div className="p-3 bg-white border border-slate-200/80 rounded-xl text-[11px] text-slate-500">
            <span className="font-semibold text-slate-700">Meta Policy Compliance:</span> Outgoing messages adhere to official Meta WhatsApp Cloud API template standards and opt-in rules.
          </div>
        </div>
      </div>

      {/* Broadcast History Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
            <History className="w-4 h-4 text-slate-500" />
            Broadcast Delivery History
          </h3>
          <span className="text-xs text-slate-500">{announcements.length} Sent</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase">
              <tr>
                <th className="py-3 px-4">Broadcast Time</th>
                <th className="py-3 px-4">Title</th>
                <th className="py-3 px-4">Audience</th>
                <th className="py-3 px-4">Recipients</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {announcements.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50/50 transition">
                  <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                    {new Date(a.created_at).toLocaleString()}
                  </td>
                  <td className="py-3 px-4 font-bold text-slate-900 max-w-xs truncate">
                    {a.title}
                  </td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded font-medium bg-slate-100 text-slate-700 text-[11px]">
                      {a.target_audience.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-bold text-slate-900">
                    {a.total_recipients} Students
                  </td>
                  <td className="py-3 px-4">
                    <StatusBadge status={a.status} size="sm" />
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => handleViewRecipients(a.id)}
                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold transition"
                    >
                      View Report
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delivery Report Modal */}
      <Modal
        isOpen={!!selectedAnnouncement}
        onClose={() => setSelectedAnnouncement(null)}
        title={`Delivery Report — ${selectedAnnouncement?.title}`}
        maxWidth="lg"
      >
        {selectedAnnouncement && (
          <div className="space-y-4">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-700 whitespace-pre-line">
              {selectedAnnouncement.message}
            </div>

            <h4 className="font-bold text-xs uppercase tracking-wider text-slate-500">Recipient Dispatch Log</h4>
            <div className="max-h-60 overflow-y-auto custom-scrollbar border border-slate-200 rounded-xl divide-y divide-slate-100 text-xs">
              {selectedAnnouncement.recipients?.map((r: any) => (
                <div key={r.id} className="p-2.5 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-900">{r.student_name}</p>
                    <p className="text-[11px] text-slate-500 font-mono">{r.phone_number}</p>
                  </div>
                  <StatusBadge status={r.status} size="sm" />
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
