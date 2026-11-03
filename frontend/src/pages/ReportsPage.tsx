import React from 'react';
import { api } from '../api/client.js';
import { FileSpreadsheet, Download, Users, Bed, CreditCard, ShieldCheck, CheckCircle2 } from 'lucide-react';

export const ReportsPage: React.FC = () => {
  const downloadCSV = async (type: string, filename: string) => {
    try {
      const csvData = await api.downloadReportUrl(type);
      // Fetch with auth header
      const res = await fetch(`/api/reports/export/${type}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('hostel_admin_token')}`
        }
      });
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}_${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      alert('Failed to download CSV report');
    }
  };

  const reportItems = [
    {
      type: 'students',
      filename: 'students_directory',
      title: 'Registered Students Directory',
      description: 'Full list of student profiles, phone numbers, academic departments, gender facilities, and roommate mode preferences.',
      icon: Users,
      badge: 'CSV Export'
    },
    {
      type: 'rooms',
      filename: 'rooms_inventory',
      title: 'Hostel Rooms & Occupancy Inventory',
      description: 'Comprehensive room listings for Alpha Male Hall and Beta Female Hall, room capacities, current occupants, and demo pricing.',
      icon: Bed,
      badge: 'CSV Export'
    },
    {
      type: 'payments',
      filename: 'payments_ledger',
      title: 'Individual Student Payments Ledger',
      description: 'Itemized individual student payments, verification timestamps, bursary reference codes, and status logs.',
      icon: CreditCard,
      badge: 'CSV Export'
    },
    {
      type: 'allocations',
      filename: 'room_allocations',
      title: 'Active Room Allocations & Expiries',
      description: 'Finalized room assignments, 12-month accommodation start dates, independent student expiry dates, and allocation statuses.',
      icon: CheckCircle2,
      badge: 'CSV Export'
    },
    {
      type: 'access_logs',
      filename: 'gate_security_access_logs',
      title: 'Gate Security & QR Checkpoint Audit',
      description: 'Complete audit log of QR digital identity scans at entry gates, verification methods (camera vs. manual), and access outcomes.',
      icon: ShieldCheck,
      badge: 'CSV Export'
    }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Hostel Reports & Data Export</h2>
        <p className="text-xs text-slate-500 mt-1">
          Export standardized CSV reports for bursary reconciliation, facility audits, and university administrative filings.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {reportItems.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.type}
              className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between hover:border-slate-300 transition"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-800">
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                    {item.badge}
                  </span>
                </div>
                <h3 className="font-bold text-base text-slate-900">{item.title}</h3>
                <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{item.description}</p>
              </div>

              <div className="pt-6 mt-4 border-t border-slate-100">
                <button
                  onClick={() => downloadCSV(item.type, item.filename)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition shadow-sm"
                >
                  <Download className="w-4 h-4" /> Download CSV Report
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
