import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { Users, Clock, ShieldCheck, Filter, UserPlus, Play } from 'lucide-react';
import { StatusBadge } from '../components/StatusBadge.js';

export const MatchingQueuePage: React.FC = () => {
  const [queue, setQueue] = useState<any[]>([]);
  const [filterHostel, setFilterHostel] = useState<string>('ALL');
  const [isLoading, setIsLoading] = useState(true);
  const [groups, setGroups] = useState<any[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const loadQueue = async () => {
    setIsLoading(true);
    try {
      const [res, groupRes] = await Promise.all([
        api.getMatchingQueue(filterHostel !== 'ALL' ? filterHostel : undefined),
        api.getBookingGroups(filterHostel !== 'ALL' ? filterHostel : undefined, 'FORMING')
      ]);
      setQueue(res.queue);
      setGroups(groupRes.groups.filter(g => g.target_capacity === 3 && g.member_count === 2 && g.members?.every((m: any) => m.auto_complete_triple_consent === 1)));
    } catch (err) {
      console.error('Failed to load matching queue:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadQueue();
  }, [filterHostel]);

  const runMatching = async () => {
    setIsRunning(true);
    try { await api.runMatching(filterHostel !== 'ALL' ? filterHostel : undefined); await loadQueue(); }
    catch (err: any) { alert(err.message || 'Matching failed'); }
    finally { setIsRunning(false); }
  };

  const completePair = async (groupId: string, queueId: string) => {
    try { await api.completeGroupFromQueue(groupId, queueId); await loadQueue(); }
    catch (err: any) { alert(err.message || 'Could not complete this group'); }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Consent-Based Random Matching Queue</h2>
        <p className="text-xs text-slate-500 mt-1">
          Students who opted into random matching. Strictly partitioned by hostel facility, room capacity, and FIFO priority timestamp.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 items-center justify-between bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
        <p className="text-xs text-slate-600">Run FIFO matching after reviewing the consented queue. A known triple pair can only receive the earliest compatible consenting student.</p>
        <button onClick={runMatching} disabled={isRunning} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold disabled:opacity-50">
          <Play className="w-3.5 h-3.5" /> {isRunning ? 'Matching…' : 'Run Matching'}
        </button>
      </div>

      {groups.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900 space-y-2">
          <p className="font-bold">Manager completion for agreed known triple pairs</p>
          {groups.map(group => {
            const candidate = queue.find(item => item.hostel_id === group.hostel_id && item.target_capacity === 3);
            return <div key={group.id} className="flex items-center justify-between gap-3">
              <span>{group.group_code} — {candidate ? `next FIFO candidate: ${candidate.full_name}` : 'no compatible candidate waiting'}</span>
              {candidate && <button onClick={() => completePair(group.id, candidate.id)} className="px-3 py-1.5 bg-amber-700 text-white rounded-lg font-semibold">Complete with next student</button>}
            </div>;
          })}
        </div>
      )}

      {/* Matching Rules Info Card */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-start gap-3 text-xs text-blue-900">
        <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-blue-950">Strict Consent & Separation Protocol</p>
          <p className="text-blue-800">
            • Only students who independently opt into random matching can enter this queue.<br />
            • Male and Female accommodation pools are kept completely separate.<br />
            • When a known pair requesting a triple room consents to a 3rd member, the highest-priority compatible student from this queue is matched automatically.<br />
            • A group becomes eligible for room allocation rolling queue once all spots are matched and complete.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between gap-4 shadow-sm">
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

        <span className="text-xs text-slate-500 font-medium">{queue.length} Student(s) in Queue</span>
      </div>

      {/* Queue Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {queue.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs">
            No students currently waiting in the matching queue.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase">
                <tr>
                  <th className="py-3 px-4">Queue Priority</th>
                  <th className="py-3 px-4">Student Name</th>
                  <th className="py-3 px-4">Facility</th>
                  <th className="py-3 px-4">Requested Occupancy</th>
                  <th className="py-3 px-4">Department & Level</th>
                  <th className="py-3 px-4">Consent Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {queue.map((item, index) => (
                  <tr key={item.id} className="hover:bg-slate-50/50 transition">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-xs shrink-0">
                          #{index + 1}
                        </span>
                        <div className="text-[11px] text-slate-500">
                          <Clock className="w-3 h-3 inline mr-1 text-slate-400" />
                          {new Date(item.queued_at).toLocaleString()}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-bold text-slate-900">
                      {item.full_name}
                      <p className="text-[11px] text-slate-400 font-mono font-normal">{item.phone_number}</p>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        item.hostel_code === 'MALE' ? 'bg-sky-50 text-sky-700 border border-sky-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                      }`}>
                        {item.hostel_name}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-800">
                      {item.target_capacity === 2 ? 'Double Room (2 Persons)' : 'Triple Room (3 Persons)'}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {item.department} ({item.academic_level})
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <ShieldCheck className="w-3 h-3" /> Independently Consented
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
