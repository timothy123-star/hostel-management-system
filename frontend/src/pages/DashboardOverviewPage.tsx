import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { StatCard } from '../components/StatCard.js';
import {
  Users,
  Bed,
  CreditCard,
  QrCode,
  CalendarClock,
  Building,
  ArrowRight,
  MessageSquare,
  History,
  ShieldCheck,
  CheckCircle2
} from 'lucide-react';
import { StatusBadge } from '../components/StatusBadge.js';

interface DashboardOverviewPageProps {
  onNavigate: (path: string) => void;
}

export const DashboardOverviewPage: React.FC<DashboardOverviewPageProps> = ({ onNavigate }) => {
  const [stats, setStats] = useState<any | null>(null);
  const [hostels, setHostels] = useState<any[]>([]);
  const [recentLogs, setRecentLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [statsRes, hostelsRes, logsRes] = await Promise.all([
          api.getOverviewStats(),
          api.getHostels(),
          api.getAuditLogs(6)
        ]);
        setStats(statsRes.stats);
        setHostels(hostelsRes.hostels);
        setRecentLogs(logsRes.logs);
      } catch (err) {
        console.error('Failed to load dashboard overview data:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  if (isLoading || !stats) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          Loading hostel statistics...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 rounded-3xl p-8 text-white relative overflow-hidden shadow-lg border border-slate-800">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/20 text-brand-400 text-xs font-semibold mb-3 border border-brand-500/30">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Accommodation & Digital Identity Command Center</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-white">
            Hostel Operations & WhatsApp Security
          </h2>
          <p className="text-slate-300 text-sm mt-1 leading-relaxed">
            Manage Alpha Male Hall and Beta Female Hall independently. Review student roommate groups, verify individual payments, automatically allocate rooms, and issue cryptographic digital entry passes.
          </p>
          <div className="flex items-center gap-3 mt-6">
            <button
              onClick={() => onNavigate('/whatsapp')}
              className="flex items-center gap-2 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-slate-950 font-semibold rounded-xl text-xs transition shadow-sm"
            >
              <MessageSquare className="w-4 h-4" /> Open WhatsApp Simulator
            </button>
            <button
              onClick={() => onNavigate('/payments')}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-xl text-xs transition border border-slate-700"
            >
              <CreditCard className="w-4 h-4" /> Review Pending Payments ({stats.pending_payments_count})
            </button>
          </div>
        </div>
      </div>

      {/* Main KPI Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard
          title="Total Registered Students"
          value={stats.total_students}
          subtext={`${stats.total_male_students} Male • ${stats.total_female_students} Female`}
          icon={<Users className="w-5 h-5" />}
        />
        <StatCard
          title="Overall Occupancy Rate"
          value={`${stats.occupancy_rate}%`}
          subtext={`${stats.current_occupancy} of ${stats.total_capacity} beds filled`}
          icon={<Bed className="w-5 h-5" />}
          variant={stats.occupancy_rate > 80 ? 'warning' : 'success'}
        />
        <StatCard
          title="Pending Payments"
          value={stats.pending_payments_count}
          subtext={`${stats.verified_payments_count} verified deposits`}
          icon={<CreditCard className="w-5 h-5" />}
          variant="warning"
        />
        <StatCard
          title="Active Digital QR Passes"
          value={stats.active_qr_count}
          subtext="Cryptographically verifiable"
          icon={<QrCode className="w-5 h-5" />}
          variant="success"
        />
      </div>

      {/* Facility Separation Summaries */}
      <div>
        <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Building className="w-4 h-4 text-slate-500" />
          Independent Accommodation Facilities
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Male Hostel Card */}
          <div className="bg-white rounded-2xl border border-sky-100 p-6 shadow-sm hover:shadow transition-shadow">
            <div className="flex items-start justify-between">
              <div>
                <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-sky-50 text-sky-700 border border-sky-200">
                  MALE HOSTEL FACILITY
                </span>
                <h4 className="text-xl font-bold text-slate-900 mt-2">Alpha Male Hall</h4>
                <p className="text-xs text-slate-500">West Wing Accommodation for Men</p>
              </div>
              <div className="text-right">
                <span className="text-2xl font-bold text-sky-700">{stats.male_occupancy_rate}%</span>
                <p className="text-xs text-slate-500">Facility Occupancy</p>
              </div>
            </div>

            <div className="mt-6">
              <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-sky-600 h-2.5 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, stats.male_occupancy_rate)}%` }}
                />
              </div>
            </div>

            <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Single, Double & Triple Occupancy Inventory
              </span>
              <button
                onClick={() => onNavigate('/male-hostel')}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700 hover:text-sky-800"
              >
                Manage Male Facility <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Female Hostel Card */}
          <div className="bg-white rounded-2xl border border-rose-100 p-6 shadow-sm hover:shadow transition-shadow">
            <div className="flex items-start justify-between">
              <div>
                <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
                  FEMALE HOSTEL FACILITY
                </span>
                <h4 className="text-xl font-bold text-slate-900 mt-2">Beta Female Hall</h4>
                <p className="text-xs text-slate-500">East Wing Accommodation for Women</p>
              </div>
              <div className="text-right">
                <span className="text-2xl font-bold text-rose-700">{stats.female_occupancy_rate}%</span>
                <p className="text-xs text-slate-500">Facility Occupancy</p>
              </div>
            </div>

            <div className="mt-6">
              <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-rose-600 h-2.5 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, stats.female_occupancy_rate)}%` }}
                />
              </div>
            </div>

            <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Single, Double & Triple Occupancy Inventory
              </span>
              <button
                onClick={() => onNavigate('/female-hostel')}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700 hover:text-rose-800"
              >
                Manage Female Facility <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Operational Watchlist Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Approaching Renewals Widget */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-amber-600" />
              Expiring Accommodations
            </h4>
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
              {stats.approaching_renewals_count} Pending Action
            </span>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Students whose independent 12-month accommodation term expires within 30 days.
          </p>
          <button
            onClick={() => onNavigate('/renewals')}
            className="w-full py-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 transition flex items-center justify-center gap-1.5"
          >
            Review & Dispatch Reminders <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Random Matching Queue Widget */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-600" />
              Random Matching Queue
            </h4>
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              {stats.matching_queue_count} Waiting
            </span>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Students who independently opted into random matching awaiting group completion.
          </p>
          <button
            onClick={() => onNavigate('/matching-queue')}
            className="w-full py-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 transition flex items-center justify-center gap-1.5"
          >
            View Matching Queue <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Bulk WhatsApp Announcements Widget */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-brand-600" />
              WhatsApp Communications
            </h4>
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              Active Provider
            </span>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Broadcast emergency alerts, clearance notices, and hostel memos directly to WhatsApp.
          </p>
          <button
            onClick={() => onNavigate('/announcements')}
            className="w-full py-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 transition flex items-center justify-center gap-1.5"
          >
            Compose Announcement <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Recent Activity / Audit Logs */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
            <History className="w-4 h-4 text-slate-500" />
            Recent Administrative Activity Log
          </h4>
          <button
            onClick={() => onNavigate('/audit-logs')}
            className="text-xs font-semibold text-brand-600 hover:text-brand-700"
          >
            View Full Audit Log →
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase">
              <tr>
                <th className="py-2.5 px-3">Timestamp</th>
                <th className="py-2.5 px-3">Action</th>
                <th className="py-2.5 px-3">Entity</th>
                <th className="py-2.5 px-3">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/50">
                  <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td className="py-2.5 px-3 font-semibold text-slate-800">
                    <StatusBadge status={log.action} size="sm" />
                  </td>
                  <td className="py-2.5 px-3 text-slate-600">
                    {log.entity_type} ({log.entity_id.slice(0, 12)}...)
                  </td>
                  <td className="py-2.5 px-3 text-slate-600 max-w-xs truncate">
                    {log.notes || '—'}
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
