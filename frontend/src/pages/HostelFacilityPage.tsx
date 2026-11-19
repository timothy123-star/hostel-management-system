import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { HostelCode, Room } from '@hostel/shared';
import { Building, Bed, Users, ShieldAlert, Edit2, Plus, Check } from 'lucide-react';
import { StatusBadge } from '../components/StatusBadge.js';
import { Modal } from '../components/Modal.js';

interface HostelFacilityPageProps {
  hostelCode: HostelCode;
  onNavigate: (path: string) => void;
}

export const HostelFacilityPage: React.FC<HostelFacilityPageProps> = ({ hostelCode, onNavigate }) => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [newPrice, setNewPrice] = useState<number>(0);
  const [isUpdatingPrice, setIsUpdatingPrice] = useState(false);

  const isMale = hostelCode === 'MALE';
  const facilityName = isMale ? 'Alpha Male Hall' : 'Beta Female Hall';
  const themeColor = isMale ? 'sky' : 'rose';

  const loadRooms = async () => {
    setIsLoading(true);
    try {
      const res = await api.getRooms(hostelCode);
      setRooms(res.rooms);
    } catch (err) {
      console.error('Failed to load facility rooms:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRooms();
  }, [hostelCode]);

  const handleOpenPriceModal = (room: Room) => {
    setEditingRoom(room);
    setNewPrice(room.price_per_student);
  };

  const handleUpdatePrice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRoom) return;
    setIsUpdatingPrice(true);
    try {
      await api.updateRoomPrice(editingRoom.id, Number(newPrice));
      setEditingRoom(null);
      await loadRooms();
    } catch (err: any) {
      alert(err.message || 'Failed to update price');
    } finally {
      setIsUpdatingPrice(false);
    }
  };

  const totalCapacity = rooms.reduce((acc, r) => acc + r.capacity, 0);
  const totalOccupants = rooms.reduce((acc, r) => acc + (r.current_occupants || 0), 0);
  const availableBeds = Math.max(0, totalCapacity - totalOccupants);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className={`bg-white border rounded-2xl p-6 shadow-sm ${isMale ? 'border-sky-200' : 'border-rose-200'}`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase ${
                isMale ? 'bg-sky-50 text-sky-700 border border-sky-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
              }`}>
                {hostelCode} HOSTEL INVENTORY
              </span>
              <span className="text-xs text-slate-400">• Independent Facility</span>
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mt-1">{facilityName}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Strictly segregated accommodation facility. Cross-allocation is blocked by system policy.
            </p>
          </div>

          <div className="flex items-center gap-4 bg-slate-50 border border-slate-200/80 rounded-xl p-3">
            <div className="text-center px-3 border-r border-slate-200">
              <p className="text-xs text-slate-500">Total Rooms</p>
              <p className="text-lg font-bold text-slate-900">{rooms.length}</p>
            </div>
            <div className="text-center px-3 border-r border-slate-200">
              <p className="text-xs text-slate-500">Total Beds</p>
              <p className="text-lg font-bold text-slate-900">{totalCapacity}</p>
            </div>
            <div className="text-center px-3">
              <p className="text-xs text-slate-500">Available Beds</p>
              <p className={`text-lg font-bold ${availableBeds > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                {availableBeds}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Security Rule Reminder */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 text-xs text-amber-900">
        <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold">Facility Separation Enforcement Rule</p>
          <p className="text-amber-800 mt-0.5">
            Students cannot be booked or allocated across facilities under any circumstance. All allocations are validated against student gender and recorded in the audit trail.
          </p>
        </div>
      </div>

      {/* Rooms Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
            <Bed className="w-4 h-4 text-slate-500" />
            Room Inventory & Occupancy
          </h3>
          <span className="text-xs text-slate-500">{rooms.length} Rooms Configured</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase">
              <tr>
                <th className="py-3 px-4">Room #</th>
                <th className="py-3 px-4">Capacity</th>
                <th className="py-3 px-4">Price / Student (DEMO)</th>
                <th className="py-3 px-4">Occupancy Status</th>
                <th className="py-3 px-4">Current Occupants</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rooms.map((r) => {
                const isFull = (r.current_occupants || 0) >= r.capacity;
                return (
                  <tr key={r.id} className="hover:bg-slate-50/50 transition">
                    <td className="py-3 px-4 font-bold text-slate-900 text-sm">
                      {r.room_number}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      <span className="font-medium">
                        {r.capacity === 1 ? 'Single (1 Person)' : r.capacity === 2 ? 'Double (2 Persons)' : 'Triple (3 Persons)'}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-800">
                      ₦{r.price_per_student.toLocaleString('en-NG')} <span className="text-[10px] text-slate-500 font-normal">NGN per resident per academic session</span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={isFull ? 'OCCUPIED' : 'AVAILABLE'} size="sm" />
                        <span className="text-slate-500 text-[11px]">
                          {r.current_occupants || 0}/{r.capacity} filled
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-700">
                      {r.occupant_students && r.occupant_students.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {r.occupant_students.map((occ) => (
                            <span
                              key={occ.id}
                              className="inline-block px-2 py-0.5 bg-slate-100 text-slate-800 rounded font-medium text-[11px]"
                            >
                              {occ.full_name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">No occupants currently</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => handleOpenPriceModal(r)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-medium transition"
                      >
                        <Edit2 className="w-3 h-3" /> Edit Price
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Price Modal */}
      <Modal
        isOpen={!!editingRoom}
        onClose={() => setEditingRoom(null)}
        title={`Configure Room Price — ${editingRoom?.room_number}`}
        maxWidth="sm"
      >
        {editingRoom && (
          <form onSubmit={handleUpdatePrice} className="space-y-4">
            <p className="text-xs text-slate-500">
              Configure inventory reference price for room <strong className="text-slate-800">{editingRoom.room_number}</strong> ({facilityName}). New obligations use the official capacity schedule.
            </p>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
              <span className="font-bold">DEMO Label:</span> This price is explicitly labelled as demo data for testing and prototype evaluation.
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                Price Per Student ($ / year)
              </label>
              <input
                type="number"
                min="0"
                step="50"
                value={newPrice}
                onChange={(e) => setNewPrice(Number(e.target.value))}
                className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
                required
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingRoom(null)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isUpdatingPrice}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-medium transition"
              >
                {isUpdatingPrice ? 'Saving...' : 'Save Price (DEMO)'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
