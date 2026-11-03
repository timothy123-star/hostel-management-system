import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { AuditLog } from '@hostel/shared';
import { History, ShieldAlert, Search, RefreshCw } from 'lucide-react';
import { StatusBadge } from '../components/StatusBadge.js';

export const AuditLogsPage: React.FC = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const loadLogs = async () => {
    setIsLoading(true);
    try {
      const res = await api.getAuditLogs(100);
      setLogs(res.logs);
    } catch (err) {
      console.error('Failed to load audit trail:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const filteredLogs = logs.filter((l) => {
    if (search) {
      const s = search.toLowerCase();
      const actionMatch = l.action.toLowerCase().includes(s);
      const entityMatch = l.entity_type.toLowerCase().includes(s);
      const notesMatch = l.notes?.toLowerCase().includes(s);
      const userMatch = l.admin_username?.toLowerCase().includes(s);
      if (!actionMatch && !entityMatch && !notesMatch && !userMatch) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Administrative Audit Trail</h2>
          <p className="text-xs text-slate-500 mt-1">
            Tamper-evident chronological log of all room overrides, payment verifications, price modifications, and security actions.
          </p>
        </div>

        <button
          onClick={loadLogs}
          className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-semibold text-slate-700 transition"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh Audit Trail
        </button>
      </div>

      {/* Search Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between shadow-sm">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search action, entity type, notes, or admin user..."
            className="w-full pl-9 pr-3.5 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
          />
        </div>
        <span className="text-xs text-slate-500">{filteredLogs.length} Logged Action(s)</span>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase">
              <tr>
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-4">Entity</th>
                <th className="py-3 px-4">Manager Notes & Overrides</th>
                <th className="py-3 px-4">Logged Admin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/50 transition">
                  <td className="py-3 px-4 text-slate-500 whitespace-nowrap font-mono text-[11px]">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td className="py-3 px-4">
                    <StatusBadge status={log.action} size="sm" />
                  </td>
                  <td className="py-3 px-4 font-medium text-slate-800">
                    {log.entity_type} <span className="text-slate-400 font-mono text-[10px]">({log.entity_id})</span>
                  </td>
                  <td className="py-3 px-4 text-slate-700 max-w-md">
                    <p className="font-medium text-slate-900">{log.notes || 'No description provided'}</p>
                    {log.new_values && (
                      <p className="text-[10px] text-slate-400 font-mono truncate mt-0.5">
                        New: {log.new_values}
                      </p>
                    )}
                  </td>
                  <td className="py-3 px-4 text-slate-600 font-semibold">
                    @{log.admin_username || 'system'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
