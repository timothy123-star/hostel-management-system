import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { RenewalOverview } from '@hostel/shared';
import { CalendarClock, Send, Filter, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { StatusBadge } from '../components/StatusBadge.js';
import { Modal } from '../components/Modal.js';

export const RenewalsPage: React.FC = () => {
  const [renewals, setRenewals] = useState<RenewalOverview[]>([]);
  const [urgencyFilter, setUrgencyFilter] = useState<string>('ALL');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Send Modal
  const [isSendOpen, setIsSendOpen] = useState(false);
  const [reminderType, setReminderType] = useState<'30_DAYS' | '14_DAYS' | '7_DAYS' | 'MANUAL_NOTICE'>('14_DAYS');
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState<any | null>(null);

  const loadRenewals = async () => {
    setIsLoading(true);
    try {
      const res = await api.getRenewals(urgencyFilter !== 'ALL' ? urgencyFilter : undefined);
      setRenewals(res.renewals);
    } catch (err) {
      console.error('Failed to load renewals:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRenewals();
  }, [urgencyFilter]);

  const handleToggleSelect = (studentId: string) => {
    setSelectedIds((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]
    );
  };

  const handleSelectAllExpiring = () => {
    const expiringIds = renewals
      .filter((r) => r.urgency !== 'UPCOMING')
      .map((r) => r.student_id);
    setSelectedIds(expiringIds);
  };

  const handleSendReminders = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedIds.length === 0) return;
    setIsSending(true);
    setSendResult(null);
    try {
      const result = await api.sendRenewalReminders(selectedIds, reminderType);
      setSendResult(result);
      setSelectedIds([]);
      await loadRenewals();
    } catch (err: any) {
      alert(err.message || 'Failed to dispatch renewal reminders');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Accommodation Expiries & Renewal Reminders</h2>
          <p className="text-xs text-slate-500 mt-1">
            Independent 12-month terms calculated from agreed accommodation start date. Preview and dispatch official WhatsApp renewal notices.
          </p>
        </div>

        <button
          onClick={() => {
            setSendResult(null);
            setIsSendOpen(true);
          }}
          disabled={selectedIds.length === 0}
          className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold shadow-sm transition disabled:opacity-50"
        >
          <Send className="w-4 h-4" />
          Send Reminders ({selectedIds.length} Selected)
        </button>
      </div>

      {/* No Auto-Charge Banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3 text-xs text-amber-900">
        <ShieldCheck className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="font-bold">Strict Non-Automatic Renewal Policy</p>
          <p className="text-amber-800 mt-0.5">
            Accommodation never renews automatically and no student card is ever automatically debited. Renewals require explicit manager clearance, payment verification, and room availability check.
          </p>
        </div>
      </div>

      {/* Filter and Selection Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs font-semibold text-slate-600">Urgency Category:</span>
          <select
            value={urgencyFilter}
            onChange={(e) => setUrgencyFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-xl bg-slate-50 font-medium"
          >
            <option value="ALL">All Expiries</option>
            <option value="CRITICAL_7_DAYS">Critical (&le; 7 Days Remaining)</option>
            <option value="WARNING_14_DAYS">Warning (&le; 14 Days Remaining)</option>
            <option value="NOTICE_30_DAYS">Notice (&le; 30 Days Remaining)</option>
            <option value="EXPIRED">Expired</option>
            <option value="UPCOMING">Upcoming (&gt; 30 Days)</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSelectAllExpiring}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition"
          >
            Select All Expiring (&le; 30 Days)
          </button>
          <button
            onClick={() => setSelectedIds([])}
            className="px-3 py-1.5 text-slate-400 hover:text-slate-600 text-xs font-medium"
          >
            Clear Selection
          </button>
        </div>
      </div>

      {/* Renewals Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase">
              <tr>
                <th className="py-3 px-4 w-10">
                  <span className="sr-only">Select</span>
                </th>
                <th className="py-3 px-4">Student</th>
                <th className="py-3 px-4">Facility & Room</th>
                <th className="py-3 px-4">Start Date</th>
                <th className="py-3 px-4">Expiry Date</th>
                <th className="py-3 px-4">Days Remaining</th>
                <th className="py-3 px-4">Urgency Status</th>
                <th className="py-3 px-4">Last Reminder Sent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {renewals.map((r) => {
                const isSelected = selectedIds.includes(r.student_id);
                return (
                  <tr key={r.student_id} className={`hover:bg-slate-50/50 transition ${isSelected ? 'bg-brand-50/30' : ''}`}>
                    <td className="py-3 px-4">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleSelect(r.student_id)}
                        className="rounded text-brand-600 focus:ring-brand-500"
                      />
                    </td>
                    <td className="py-3 px-4">
                      <p className="font-bold text-slate-900">{r.student_name}</p>
                      <p className="text-[11px] text-slate-500 font-mono">{r.phone_number}</p>
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-semibold text-slate-900">Room {r.room_number}</span>
                      <p className="text-[11px] text-slate-500">{r.hostel_name}</p>
                    </td>
                    <td className="py-3 px-4 text-slate-600">{r.accommodation_start_date}</td>
                    <td className="py-3 px-4 font-semibold text-slate-900">{r.accommodation_end_date}</td>
                    <td className="py-3 px-4">
                      <span className={`font-bold ${
                        r.days_remaining < 0
                          ? 'text-rose-600'
                          : r.days_remaining <= 7
                          ? 'text-rose-600 font-bold'
                          : r.days_remaining <= 14
                          ? 'text-amber-600 font-bold'
                          : 'text-slate-700'
                      }`}>
                        {r.days_remaining < 0 ? `${Math.abs(r.days_remaining)} days ago` : `${r.days_remaining} day(s)`}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge status={r.urgency} size="sm" />
                    </td>
                    <td className="py-3 px-4 text-slate-500 text-[11px]">
                      {r.last_reminder_sent_at ? (
                        <span>{new Date(r.last_reminder_sent_at).toLocaleDateString()}</span>
                      ) : (
                        <span className="text-slate-400 italic">None logged</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Send Reminders Modal */}
      <Modal
        isOpen={isSendOpen}
        onClose={() => setIsSendOpen(false)}
        title="Dispatch WhatsApp Renewal Reminders"
        maxWidth="md"
      >
        <form onSubmit={handleSendReminders} className="space-y-4">
          {sendResult ? (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-xs space-y-2">
              <div className="flex items-center gap-2 font-bold text-sm">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" /> Reminders Dispatched
              </div>
              <p>Successfully processed {sendResult.sent} notification(s).</p>
              <button
                type="button"
                onClick={() => setIsSendOpen(false)}
                className="w-full mt-2 py-2 bg-emerald-600 text-white rounded-lg font-semibold"
              >
                Close
              </button>
            </div>
          ) : (
            <>
              <p className="text-xs text-slate-500">
                You are about to dispatch renewal notices to <strong>{selectedIds.length}</strong> selected student(s) via WhatsApp.
              </p>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">Reminder Interval Type</label>
                <select
                  value={reminderType}
                  onChange={(e) => setReminderType(e.target.value as any)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:ring-2 focus:ring-brand-500 focus:outline-none"
                >
                  <option value="30_DAYS">30-Day Expiry Notice</option>
                  <option value="14_DAYS">14-Day Urgent Reminder</option>
                  <option value="7_DAYS">7-Day Critical Final Notice</option>
                  <option value="MANUAL_NOTICE">Custom Clearance Expiry Notice</option>
                </select>
              </div>

              {/* Message Preview */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-700 space-y-1">
                <p className="font-semibold text-slate-900">Message Preview:</p>
                <div className="bg-white p-3 rounded-lg border border-slate-200 font-mono text-[11px] text-slate-600 whitespace-pre-line">
                  {`🏛️ *HOSTEL ACCOMMODATION RENEWAL NOTICE*\n\nDear [Student Name],\nYour accommodation at [Facility Name] (Room [Room#]) expires in [X] day(s).\n\nPlease reply or visit the hostel bursary to initiate renewal for the upcoming session.`}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsSendOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-medium text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSending}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition disabled:opacity-50"
                >
                  {isSending ? 'Dispatching Reminders...' : 'Send Notices via WhatsApp'}
                </button>
              </div>
            </>
          )}
        </form>
      </Modal>
    </div>
  );
};
