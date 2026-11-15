import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { Student, Room } from '@hostel/shared';
import { Users, Search, Filter, QrCode, CreditCard, ArrowRight, Bed, Eye, RefreshCw, AlertCircle, Camera } from 'lucide-react';
import { StatusBadge } from '../components/StatusBadge.js';
import { Modal } from '../components/Modal.js';

export const StudentsPage: React.FC = () => {
  const [students, setStudents] = useState<Student[]>([]);
  const [search, setSearch] = useState('');
  const [genderFilter, setGenderFilter] = useState<string>('ALL');
  const [levelFilter, setLevelFilter] = useState<string>('ALL');
  const [isLoading, setIsLoading] = useState(true);

  // Selected student for detail modal
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

  // Reallocation modal state
  const [isReallocating, setIsReallocating] = useState(false);
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [reallocateReason, setReallocateReason] = useState('');
  const [reallocError, setReallocError] = useState<string | null>(null);
  const [isSubmittingRealloc, setIsSubmittingRealloc] = useState(false);
  const [photoLinkMessage, setPhotoLinkMessage] = useState<string | null>(null);

  const loadStudents = async () => {
    setIsLoading(true);
    try {
      const res = await api.getStudents({
        search: search.trim() || undefined,
        gender: genderFilter !== 'ALL' ? genderFilter : undefined,
        level: levelFilter !== 'ALL' ? levelFilter : undefined
      });
      setStudents(res.students);
    } catch (err) {
      console.error('Failed to load students:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      loadStudents();
    }, 250);
    return () => clearTimeout(delayDebounce);
  }, [search, genderFilter, levelFilter]);

  const handleOpenDetail = async (studentId: string) => {
    try {
      const res = await api.getStudentById(studentId);
      setSelectedStudent(res.student);
    } catch (err) {
      alert('Failed to load student details');
    }
  };

  const handleStartReallocation = async () => {
    if (!selectedStudent || !selectedStudent.current_allocation) return;
    setReallocError(null);
    setIsReallocating(true);
    try {
      const res = await api.getRooms(selectedStudent.gender);
      // Filter out rooms that are at capacity or maintenance or current room
      const currentRoomId = selectedStudent.current_allocation.room_id;
      const candidates = res.rooms.filter(
        (r) => r.id !== currentRoomId && (r.current_occupants || 0) < r.capacity && r.status !== 'MAINTENANCE'
      );
      setAvailableRooms(candidates);
      if (candidates.length > 0) {
        setSelectedRoomId(candidates[0].id);
      }
    } catch (err) {
      setReallocError('Failed to fetch compatible rooms');
    }
  };

  const handleSubmitReallocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudent || !selectedRoomId || !reallocateReason.trim()) return;
    setIsSubmittingRealloc(true);
    setReallocError(null);
    try {
      await api.reallocateStudent({
        studentId: selectedStudent.id,
        newRoomId: selectedRoomId,
        reason: reallocateReason.trim()
      });
      setIsReallocating(false);
      setReallocateReason('');
      // Reload student details and list
      await handleOpenDetail(selectedStudent.id);
      await loadStudents();
    } catch (err: any) {
      setReallocError(err.message || 'Reallocation failed');
    } finally {
      setIsSubmittingRealloc(false);
    }
  };

  const issuePhotoLink = async () => {
    if (!selectedStudent) return;
    setPhotoLinkMessage(null);
    try {
      const result = await api.issueStudentPhotoUploadLink(selectedStudent.id);
      setPhotoLinkMessage(`Secure link sent through the WhatsApp simulator. It expires ${new Date(result.expires_at).toLocaleTimeString()}.`);
    } catch (error: any) { setPhotoLinkMessage(error.message || 'Could not issue photo upload link.'); }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Student Accommodation Directory</h2>
        <p className="text-xs text-slate-500 mt-1">
          Complete individual student records, roommate memberships, digital identity passes, and room allocations.
        </p>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-4 shadow-sm">
        <div className="relative flex-1 min-w-[280px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by student name, phone number, or department..."
            className="w-full pl-9 pr-3.5 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-xs font-semibold text-slate-600">Facility:</span>
            <select
              value={genderFilter}
              onChange={(e) => setGenderFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-xl bg-slate-50 font-medium"
            >
              <option value="ALL">All Facilities</option>
              <option value="MALE">Male Students</option>
              <option value="FEMALE">Female Students</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-600">Level:</span>
            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-xl bg-slate-50 font-medium"
            >
              <option value="ALL">All Academic Levels</option>
              <option value="100 Level">100 Level</option>
              <option value="200 Level">200 Level</option>
              <option value="300 Level">300 Level</option>
              <option value="400 Level">400 Level</option>
              <option value="500 Level">500 Level</option>
              <option value="Postgraduate">Postgraduate</option>
            </select>
          </div>
        </div>
      </div>

      {/* Students Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase">
              <tr>
                <th className="py-3 px-4">Student</th>
                <th className="py-3 px-4">Phone Number</th>
                <th className="py-3 px-4">Facility & Dept</th>
                <th className="py-3 px-4">Room & Group</th>
                <th className="py-3 px-4">Payment</th>
                <th className="py-3 px-4">QR Pass Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {students.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/50 transition">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <img
                        src={s.photo_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(s.full_name)}`}
                        alt={s.full_name}
                        className="w-8 h-8 rounded-full bg-slate-100 object-cover"
                      />
                      <div>
                        <p className="font-bold text-slate-900">{s.full_name}</p>
                        <p className="text-[11px] text-slate-500">{s.academic_level}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-700">{s.phone_number}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      s.gender === 'MALE' ? 'bg-sky-50 text-sky-700 border border-sky-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                    }`}>
                      {s.gender === 'MALE' ? 'Male Hall' : 'Female Hall'}
                    </span>
                    <p className="text-slate-600 mt-0.5">{s.department}</p>
                  </td>
                  <td className="py-3 px-4">
                    {s.current_allocation ? (
                      <span className="font-bold text-slate-900 text-xs">
                        Room {s.current_allocation.room?.room_number || s.current_allocation.room_id}
                      </span>
                    ) : (
                      <span className="text-slate-400 italic">Unallocated</span>
                    )}
                    {s.current_group && (
                      <p className="text-[11px] text-slate-500 font-mono">
                        {s.current_group.group_code} ({s.current_group.status.replace(/_/g, ' ')})
                      </p>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {s.payment ? (
                      <StatusBadge status={s.payment.status} size="sm" />
                    ) : (
                      <span className="text-slate-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {s.qr_credential ? (
                      <StatusBadge status={s.qr_credential.status} size="sm" />
                    ) : (
                      <span className="text-slate-400 text-xs italic">Not issued</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => handleOpenDetail(s.id)}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold transition"
                    >
                      <Eye className="w-3.5 h-3.5" /> Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Student Detail Modal */}
      <Modal
        isOpen={!!selectedStudent}
        onClose={() => {
          setSelectedStudent(null);
          setIsReallocating(false);
        }}
        title={`Student Profile — ${selectedStudent?.full_name}`}
        maxWidth="xl"
      >
        {selectedStudent && (
          <div className="space-y-6">
            {/* Header info card */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 flex items-start gap-4">
              <img
                src={selectedStudent.photo_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(selectedStudent.full_name)}`}
                alt={selectedStudent.full_name}
                className="w-16 h-16 rounded-2xl bg-white border border-slate-200 object-cover shadow-sm"
              />
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-slate-900">{selectedStudent.full_name}</h3>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                    selectedStudent.gender === 'MALE' ? 'bg-sky-50 text-sky-700 border border-sky-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                  }`}>
                    {selectedStudent.gender === 'MALE' ? 'Alpha Male Hall' : 'Beta Female Hall'}
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-1 font-mono">{selectedStudent.phone_number}</p>
                <p className="text-xs text-slate-600 mt-0.5">
                  {selectedStudent.department} • {selectedStudent.academic_level} • Preferred Occupancy: {selectedStudent.preferred_occupancy}-Person
                </p>
              </div>
            </div>

            {/* Room Allocation Card */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <Bed className="w-4 h-4 text-slate-500" /> Current Room Allocation
                </h4>
                {selectedStudent.current_allocation && (
                  <StatusBadge status={selectedStudent.current_allocation.status} />
                )}
              </div>

              {selectedStudent.current_allocation ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                    <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                      <p className="text-slate-500">Room Number</p>
                      <p className="font-bold text-slate-900 text-sm mt-0.5">
                        {selectedStudent.current_allocation.room?.room_number || 'Assigned'}
                      </p>
                    </div>
                    <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                      <p className="text-slate-500">Accommodation Start</p>
                      <p className="font-semibold text-slate-900 mt-0.5">
                        {selectedStudent.current_allocation.accommodation_start_date}
                      </p>
                    </div>
                    <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                      <p className="text-slate-500">Accommodation Expiry</p>
                      <p className="font-semibold text-slate-900 mt-0.5">
                        {selectedStudent.current_allocation.accommodation_end_date}
                      </p>
                    </div>
                  </div>

                  <div className="pt-2">
                    <button
                      onClick={handleStartReallocation}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium transition"
                    >
                      Reallocate to Another Room (Manager Override)
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500 italic">No room allocated yet. Awaiting group completion and payment verification.</p>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-3"><div><h4 className="font-bold text-sm text-slate-900 flex items-center gap-2"><Camera className="w-4 h-4 text-slate-500" /> Resident photograph</h4><p className="text-xs text-slate-500 mt-1">Status: {selectedStudent.photo_status?.replace(/_/g, ' ') || 'NOT SUBMITTED'}</p></div>
                <button onClick={issuePhotoLink} className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium">Send secure upload link</button></div>
              {photoLinkMessage && <p className="text-xs rounded-lg border border-sky-200 bg-sky-50 p-2 text-sky-800">{photoLinkMessage}</p>}
            </div>

            {/* Reallocation Form (Inline in modal) */}
            {isReallocating && (
              <form onSubmit={handleSubmitReallocation} className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-xs text-amber-900 uppercase tracking-wider">
                    Manager Room Reallocation Override
                  </h4>
                  <button
                    type="button"
                    onClick={() => setIsReallocating(false)}
                    className="text-xs text-amber-700 hover:underline"
                  >
                    Cancel
                  </button>
                </div>

                {reallocError && (
                  <p className="text-xs text-rose-700 bg-rose-50 p-2 rounded-lg border border-rose-200">{reallocError}</p>
                )}

                <div>
                  <label className="block text-xs font-semibold text-amber-900 mb-1">
                    Select New Compatible Room ({selectedStudent.gender} Hostel only)
                  </label>
                  <select
                    value={selectedRoomId}
                    onChange={(e) => setSelectedRoomId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-amber-300 rounded-xl bg-white focus:outline-none"
                    required
                  >
                    {availableRooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        Room {r.room_number} (Capacity: {r.capacity}, Available: {r.capacity - (r.current_occupants || 0)} spots)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-amber-900 mb-1">
                    Reason for Reallocation (Audit Trail Required)
                  </label>
                  <input
                    type="text"
                    value={reallocateReason}
                    onChange={(e) => setReallocateReason(e.target.value)}
                    placeholder="e.g. Maintenance in previous wing, accessibility accommodation"
                    className="w-full px-3 py-2 text-xs border border-amber-300 rounded-xl bg-white focus:outline-none"
                    required
                  />
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={isSubmittingRealloc || !selectedRoomId || !reallocateReason.trim()}
                    className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold disabled:opacity-50"
                  >
                    {isSubmittingRealloc ? 'Reallocating...' : 'Confirm Reallocation'}
                  </button>
                </div>
              </form>
            )}

            {/* QR Identity Pass Preview */}
            {selectedStudent.qr_credential && (
              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                    <QrCode className="w-4 h-4 text-slate-500" /> Digital Identity Gate Pass
                  </h4>
                  <StatusBadge status={selectedStudent.qr_credential.status} />
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                  {selectedStudent.qr_credential.qr_image_data && (
                    <img
                      src={selectedStudent.qr_credential.qr_image_data}
                      alt="Digital Pass QR"
                      className="w-32 h-32 rounded-xl bg-white p-2 border border-slate-200 shadow-sm shrink-0"
                    />
                  )}
                  <div className="text-xs space-y-1">
                    <p className="font-mono text-slate-500 break-all">
                      <span className="font-semibold text-slate-700">Token Hash:</span> {selectedStudent.qr_credential.token_hash}
                    </p>
                    <p className="text-slate-600">
                      <span className="font-semibold">Issued:</span> {new Date(selectedStudent.qr_credential.issued_at).toLocaleString()}
                    </p>
                    {selectedStudent.qr_credential.status === 'REVOKED' && (
                      <p className="text-rose-600 font-semibold">
                        Revocation Reason: {selectedStudent.qr_credential.revoke_reason}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};
