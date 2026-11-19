import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { BookingGroup, Room } from '@hostel/shared';
import { UserCheck, CheckCircle2, AlertTriangle, Key, Bed, ArrowRight, ShieldCheck, Filter } from 'lucide-react';
import { StatusBadge } from '../components/StatusBadge.js';
import { Modal } from '../components/Modal.js';
const formatPaymentAmount = (amount: number, currency: string, amountKobo?: number | null): string => {
  if (currency === 'NGN' && amountKobo !== null && amountKobo !== undefined) {
    try { if (!Number.isInteger(amountKobo) || amountKobo % 100 !== 0) throw new Error('bad'); return `₦${(amountKobo / 100).toLocaleString('en-NG')} per academic session`; } catch { /* fall through */ }
  }
  if (currency === 'NGN') return `₦${Number(amount).toLocaleString('en-NG')} per academic session`;
  return `$${amount} ${currency} (DEMO price)`;
};

export const BookingGroupsPage: React.FC = () => {
  const [groups, setGroups] = useState<BookingGroup[]>([]);
  const [filterHostel, setFilterHostel] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [isLoading, setIsLoading] = useState(true);

  // Finalize Allocation Modal
  const [finalizingGroup, setFinalizingGroup] = useState<BookingGroup | null>(null);
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [isOverride, setIsOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [relocatingGroup, setRelocatingGroup] = useState<BookingGroup | null>(null);
  const [relocationRoomId, setRelocationRoomId] = useState('');
  const [relocationReason, setRelocationReason] = useState('');
  const [relocationAvailabilityMessage, setRelocationAvailabilityMessage] = useState('');

  const loadGroups = async () => {
    setIsLoading(true);
    try {
      const res = await api.getBookingGroups(
        filterHostel !== 'ALL' ? filterHostel : undefined,
        filterStatus !== 'ALL' ? filterStatus : undefined
      );
      setGroups(res.groups);
    } catch (err) {
      console.error('Failed to load booking groups:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadGroups();
  }, [filterHostel, filterStatus]);

  const handleOpenFinalize = async (group: BookingGroup) => {
    setFinalizingGroup(group);
    setFinalizeError(null);
    setIsOverride(false);
    setOverrideReason('');
    try {
      const roomsRes = await api.getRooms(group.hostel_code);
      // Compatible rooms with matching capacity and available spots
      const candidates = roomsRes.rooms.filter(
        (r) => (r.capacity - (r.current_occupants || 0)) >= group.target_capacity && r.status !== 'MAINTENANCE'
      );
      setAvailableRooms(candidates);
      if (group.held_room_id) {
        setSelectedRoomId(group.held_room_id);
      } else if (candidates.length > 0) {
        setSelectedRoomId(candidates[0].id);
      }
    } catch (err) {
      console.error('Failed to fetch rooms for finalization:', err);
    }
  };

  const handleFinalizeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!finalizingGroup) return;
    setIsSubmitting(true);
    setFinalizeError(null);
    try {
      await api.finalizeAllocation({
        groupId: finalizingGroup.id,
        accommodationStartDate: startDate,
        overrideRoomId: isOverride ? selectedRoomId : undefined,
        overrideReason: isOverride ? overrideReason : undefined
      });
      setFinalizingGroup(null);
      await loadGroups();
    } catch (err: any) {
      setFinalizeError(err.message || 'Failed to finalize allocation');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openGroupRelocation = async (group: BookingGroup) => {
    setRelocatingGroup(group); setRelocationReason('');
    const res = await api.getRooms(group.hostel_code);
    const candidates = res.rooms.filter(room => room.id !== group.held_room_id && room.capacity === group.target_capacity && room.status === 'AVAILABLE' && !room.held_by_group_id && (room.current_occupants || 0) === 0);
    setAvailableRooms(candidates); setRelocationRoomId(candidates[0]?.id || '');
    setRelocationAvailabilityMessage(candidates.length ? '' : `No eligible empty ${group.target_capacity === 1 ? 'single' : group.target_capacity === 2 ? 'double' : 'triple'} rooms are currently available in this facility. Rooms must be AVAILABLE, empty, unheld, and match the group capacity exactly.`);
  };

  const submitGroupRelocation = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!relocatingGroup || !relocationRoomId || relocationReason.trim().length < 3) return;
    await api.reallocateGroup({ groupId: relocatingGroup.id, newRoomId: relocationRoomId, reason: relocationReason.trim() });
    setRelocatingGroup(null); await loadGroups();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Booking Groups & Roommate Status</h2>
        <p className="text-xs text-slate-500 mt-1">
          Known roommate groups and completed random matching groups. Allocation is finalized only when all members are verified.
        </p>
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-xs font-semibold text-slate-600">Facility:</span>
            <select
              value={filterHostel}
              onChange={(e) => setFilterHostel(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-xl bg-slate-50 font-medium"
            >
              <option value="ALL">All Facilities</option>
              <option value="MALE">Alpha Male Hall</option>
              <option value="FEMALE">Beta Female Hall</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-600">Status:</span>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-xl bg-slate-50 font-medium"
            >
              <option value="ALL">All Statuses</option>
              <option value="READY_FOR_ALLOCATION">Ready for Allocation</option>
              <option value="FORMING">Forming (Waiting for Roommates)</option>
              <option value="ALLOCATED">Finalized & Allocated</option>
            </select>
          </div>
        </div>
      </div>

      {/* Groups List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {groups.map((g) => {
          const verifiedCount = g.members?.filter((m) => m.payment?.status === 'VERIFIED').length || 0;
          const isComplete = (g.member_count || 0) === g.target_capacity;
          const allVerified = g.all_payments_verified;

          return (
            <div key={g.id} className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-sm bg-slate-100 text-slate-900 px-2.5 py-1 rounded-lg">
                      {g.group_code}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      g.hostel_code === 'MALE' ? 'bg-sky-50 text-sky-700 border border-sky-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                    }`}>
                      {g.hostel_code}
                    </span>
                  </div>
                  <StatusBadge status={g.status} size="sm" />
                </div>

                <div className="flex items-center justify-between text-xs text-slate-500 mb-4 pb-3 border-b border-slate-100">
                  <span>Target Occupancy: <strong className="text-slate-700">{g.target_capacity}-Person Room</strong></span>
                  <span>Members: <strong className="text-slate-700">{g.member_count || 0}/{g.target_capacity}</strong></span>
                </div>
                {g.provisional_room && <div className="mb-4 p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-900"><strong>Temporary room hold — not allocated:</strong> Room {g.provisional_room.room_number}, capacity {g.provisional_room.capacity}, ₦{g.provisional_room.price_per_student.toLocaleString('en-NG')} NGN per resident per academic session. This proposal is shown before payment and is released if final allocation does not proceed.</div>}

                {/* Member List */}
                <div className="space-y-2 mb-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Group Members & Payments</p>
                  {g.members?.map((m) => (
                    <div key={m.id} className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-xs">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${m.payment?.status === 'VERIFIED' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                        <div>
                          <p className="font-bold text-slate-900">{m.student.full_name}</p>
                          <p className="text-[11px] text-slate-500 font-mono">{m.student.phone_number}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <StatusBadge status={m.payment?.status || 'PENDING'} size="sm" />
                        <p className="text-[10px] text-slate-400 mt-0.5">{m.payment ? formatPaymentAmount(m.payment.amount, m.payment.currency, (m.payment as any).amount_kobo ?? null) : '$0 USD (DEMO price)'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Button Footer */}
              <div className="pt-4 border-t border-slate-100">
                {g.status === 'READY_FOR_ALLOCATION' && (
                  <button
                    onClick={() => handleOpenFinalize(g)}
                    disabled={!allVerified}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition disabled:opacity-50"
                  >
                    <Bed className="w-4 h-4" />
                    {allVerified ? 'Finalize Room Allocation' : `Awaiting Payments (${verifiedCount}/${g.target_capacity} Verified)`}
                  </button>
                )}

                {g.status === 'FORMING' && (
                  <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 text-center">
                    Waiting for roommates to enter code <strong className="font-mono">{g.group_code}</strong> on WhatsApp.
                  </div>
                )}

                {g.status === 'ALLOCATED' && (
                  <div className="space-y-2"><div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 text-center flex items-center justify-center gap-1.5 font-medium"><CheckCircle2 className="w-4 h-4 text-emerald-600" /> Allocation finalized. Credentials require explicit manager issuance.</div>
                  <button onClick={() => openGroupRelocation(g)} className="w-full py-2 text-xs font-semibold rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50">Relocate whole group (reason required)</button></div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Finalize Allocation Modal */}
      <Modal
        isOpen={!!finalizingGroup}
        onClose={() => setFinalizingGroup(null)}
        title={`Finalize Allocation — Group ${finalizingGroup?.group_code}`}
        maxWidth="lg"
      >
        {finalizingGroup && (
          <form onSubmit={handleFinalizeSubmit} className="space-y-4">
            {finalizeError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
                {finalizeError}
              </div>
            )}

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 space-y-1">
              <p><strong>Facility:</strong> {finalizingGroup.hostel_code === 'MALE' ? 'Alpha Male Hall' : 'Beta Female Hall'}</p>
              <p><strong>Required Capacity:</strong> {finalizingGroup.target_capacity} Student(s)</p>
              <p><strong>Members:</strong> {finalizingGroup.members?.map(m => m.student.full_name).join(', ')}</p>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
                Accommodation Start Date (12-Month Duration)
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
                required
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Expiry will be calculated exactly 12 months after this agreed start date.
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold uppercase text-slate-600">
                  Select Compatible Room
                </label>
                <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isOverride}
                    onChange={(e) => setIsOverride(e.target.checked)}
                    className="rounded text-brand-600 focus:ring-brand-500"
                  />
                  <span>Manager Room Override</span>
                </label>
              </div>

              <select
                value={selectedRoomId}
                onChange={(e) => setSelectedRoomId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:ring-2 focus:ring-brand-500 focus:outline-none"
                required
              >
                {availableRooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    Room {r.room_number} (Capacity: {r.capacity}, Available: {r.capacity - (r.current_occupants || 0)} beds)
                  </option>
                ))}
              </select>
            </div>

            {isOverride && (
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
                  Reason for Manager Room Override (Audit Trail Required)
                </label>
                <input
                  type="text"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="e.g. Ground floor preference, roommate compatibility"
                  className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
                  required={isOverride}
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setFinalizingGroup(null)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !selectedRoomId}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition disabled:opacity-50"
              >
                {isSubmitting ? 'Finalizing Allocation...' : 'Confirm Final Allocation'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal isOpen={!!relocatingGroup} onClose={() => setRelocatingGroup(null)} title={`Relocate Group — ${relocatingGroup?.group_code}`} maxWidth="md">
        <form onSubmit={submitGroupRelocation} className="space-y-4">
          <p className="text-xs text-slate-600">This moves every active member together, preserving their accommodation dates and QR credentials. Only an empty room of the same facility and occupancy may be selected.</p>
          <select value={relocationRoomId} onChange={e => setRelocationRoomId(e.target.value)} className="w-full px-3 py-2 border rounded-xl text-sm" required>
            {availableRooms.map(room => <option key={room.id} value={room.id}>Room {room.room_number} — {room.capacity} beds, ₦{room.price_per_student.toLocaleString('en-NG')} NGN/student/session</option>)}
          </select>
          {relocationAvailabilityMessage && <p className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">{relocationAvailabilityMessage}</p>}
          <input value={relocationReason} onChange={e => setRelocationReason(e.target.value)} placeholder="Documented manager reason" className="w-full px-3 py-2 border rounded-xl text-sm" required />
          <button disabled={!relocationRoomId || relocationReason.trim().length < 3} className="w-full py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold disabled:opacity-50">Confirm whole-group relocation</button>
        </form>
      </Modal>
    </div>
  );
};
