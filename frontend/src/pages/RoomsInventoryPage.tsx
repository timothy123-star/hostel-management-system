import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { Room, HostelCode } from '@hostel/shared';
import { Bed, Plus, Search, Filter, Edit2, Building } from 'lucide-react';
import { StatusBadge } from '../components/StatusBadge.js';
import { Modal } from '../components/Modal.js';

export const RoomsInventoryPage: React.FC = () => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [hostels, setHostels] = useState<any[]>([]);
  const [filterHostel, setFilterHostel] = useState<string>('ALL');
  const [filterCapacity, setFilterCapacity] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Modals
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [newPrice, setNewPrice] = useState<number>(0);

  // New room form
  const [newRoomNumber, setNewRoomNumber] = useState('');
  const [newHostelId, setNewHostelId] = useState('');
  const [newCapacity, setNewCapacity] = useState<number>(1);
  const [newRoomPrice, setNewRoomPrice] = useState<number>(1200);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [roomsRes, hostelsRes] = await Promise.all([
        api.getRooms(),
        api.getHostels()
      ]);
      setRooms(roomsRes.rooms);
      setHostels(hostelsRes.hostels);
      if (hostelsRes.hostels.length > 0 && !newHostelId) {
        setNewHostelId(hostelsRes.hostels[0].id);
      }
    } catch (err) {
      console.error('Failed to load room inventory:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createRoom({
        hostel_id: newHostelId,
        room_number: newRoomNumber.trim(),
        capacity: Number(newCapacity),
        price_per_student: Number(newRoomPrice)
      });
      setIsAddOpen(false);
      setNewRoomNumber('');
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to create room');
    }
  };

  const handleUpdatePrice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRoom) return;
    try {
      await api.updateRoomPrice(editingRoom.id, Number(newPrice));
      setEditingRoom(null);
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to update price');
    }
  };

  const filteredRooms = rooms.filter((r) => {
    if (filterHostel !== 'ALL' && r.hostel_code !== filterHostel) return false;
    if (filterCapacity !== 'ALL' && r.capacity !== Number(filterCapacity)) return false;
    if (search && !r.room_number.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Room Inventory Management</h2>
          <p className="text-xs text-slate-500 mt-1">
            Configure room capacities, track real-time occupancy, and update demo room pricing.
          </p>
        </div>

        <button
          onClick={() => setIsAddOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold shadow-sm transition"
        >
          <Plus className="w-4 h-4" /> Add New Room
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3 flex-1 min-w-[260px]">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search room number (e.g. M-101)..."
              className="w-full pl-9 pr-3.5 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-xs font-semibold text-slate-600">Facility:</span>
            <select
              value={filterHostel}
              onChange={(e) => setFilterHostel(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none bg-slate-50 font-medium"
            >
              <option value="ALL">All Facilities</option>
              <option value="MALE">Alpha Male Hall</option>
              <option value="FEMALE">Beta Female Hall</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-600">Capacity:</span>
            <select
              value={filterCapacity}
              onChange={(e) => setFilterCapacity(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none bg-slate-50 font-medium"
            >
              <option value="ALL">All Types</option>
              <option value="1">Single (1)</option>
              <option value="2">Double (2)</option>
              <option value="3">Triple (3)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase">
              <tr>
                <th className="py-3 px-4">Room #</th>
                <th className="py-3 px-4">Facility</th>
                <th className="py-3 px-4">Capacity</th>
                <th className="py-3 px-4">Price / Student (DEMO)</th>
                <th className="py-3 px-4">Status & Occupancy</th>
                <th className="py-3 px-4">Current Occupants</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRooms.map((r) => {
                const isFull = (r.current_occupants || 0) >= r.capacity;
                return (
                  <tr key={r.id} className="hover:bg-slate-50/50 transition">
                    <td className="py-3 px-4 font-bold text-slate-900 text-sm">
                      {r.room_number}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                        r.hostel_code === 'MALE' ? 'bg-sky-50 text-sky-700 border border-sky-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                      }`}>
                        {r.hostel_code}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-700 font-medium">
                      {r.capacity === 1 ? 'Single Room (1)' : r.capacity === 2 ? 'Double Room (2)' : 'Triple Room (3)'}
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      ₦{r.price_per_student.toLocaleString('en-NG')} <span className="text-[10px] text-slate-500 font-normal">NGN per session</span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={isFull ? 'OCCUPIED' : 'AVAILABLE'} size="sm" />
                        <span className="text-slate-500 text-[11px]">
                          {r.current_occupants || 0}/{r.capacity} beds
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-700">
                      {r.occupant_students && r.occupant_students.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {r.occupant_students.map((occ) => (
                            <span
                              key={occ.id}
                              className="px-2 py-0.5 bg-slate-100 text-slate-800 rounded font-medium text-[11px]"
                            >
                              {occ.full_name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">Empty</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => {
                          setEditingRoom(r);
                          setNewPrice(r.price_per_student);
                        }}
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

      {/* Add Room Modal */}
      <Modal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} title="Add New Hostel Room">
        <form onSubmit={handleCreateRoom} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">Hostel Facility</label>
            <select
              value={newHostelId}
              onChange={(e) => setNewHostelId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:ring-2 focus:ring-brand-500 focus:outline-none"
              required
            >
              {hostels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} ({h.code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">Room Number</label>
            <input
              type="text"
              value={newRoomNumber}
              onChange={(e) => setNewRoomNumber(e.target.value)}
              placeholder="e.g. M-401 or F-303"
              className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">Occupancy Capacity</label>
            <select
              value={newCapacity}
              onChange={(e) => setNewCapacity(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:ring-2 focus:ring-brand-500 focus:outline-none"
            >
              <option value={1}>Single Room (1 Student)</option>
              <option value={2}>Double Room (2 Students)</option>
              <option value={3}>Triple Room (3 Students)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">Price Per Student (₦ NGN per resident per academic session)</label>
            <input
              type="number"
              min="0"
              step="50"
              value={newRoomPrice}
              onChange={(e) => setNewRoomPrice(Number(e.target.value))}
              className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
              required
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsAddOpen(false)}
              className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-medium transition"
            >
              Create Room
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Price Modal */}
      <Modal
        isOpen={!!editingRoom}
        onClose={() => setEditingRoom(null)}
        title={`Edit Room Price — ${editingRoom?.room_number}`}
        maxWidth="sm"
      >
        {editingRoom && (
          <form onSubmit={handleUpdatePrice} className="space-y-4">
            <p className="text-xs text-slate-500">
              Update inventory reference price for Room <strong>{editingRoom.room_number}</strong> ({editingRoom.hostel_code} Hostel).
            </p>
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">Price Per Student (₦ NGN)</label>
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
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-medium text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-medium transition"
              >
                Update Price (DEMO)
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
