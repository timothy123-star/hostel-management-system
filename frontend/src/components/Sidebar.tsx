import React from 'react';
import {
  LayoutDashboard,
  Building,
  Users,
  Bed,
  UserCheck,
  CreditCard,
  QrCode,
  CalendarClock,
  Megaphone,
  FileSpreadsheet,
  History,
  MessageSquare,
  LogOut,
  ShieldCheck,
  Camera,
  KeyRound,
  X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';

interface SidebarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  onOpenScanner: () => void;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentPath, onNavigate, onOpenScanner, mobileOpen = false, onCloseMobile }) => {
  const { user, logout } = useAuth();

  const navItems = [
    { path: '/', label: 'Overview', icon: LayoutDashboard },
    { path: '/male-hostel', label: 'Male Hostel', icon: Building, color: 'text-sky-600' },
    { path: '/female-hostel', label: 'Female Hostel', icon: Building, color: 'text-rose-600' },
    { path: '/rooms', label: 'Room Inventory', icon: Bed },
    { path: '/students', label: 'Student Directory', icon: Users },
    { path: '/photo-reviews', label: 'Photograph Reviews', icon: Camera },
    { path: '/groups', label: 'Booking Groups', icon: UserCheck },
    { path: '/matching-queue', label: 'Matching Queue', icon: Users },
    { path: '/payments', label: 'Payments & Approvals', icon: CreditCard },
    { path: '/qr-identity', label: 'QR Digital Identity', icon: QrCode },
    { path: '/security-accounts', label: 'Security Accounts', icon: KeyRound },
    { path: '/renewals', label: 'Expiries & Renewals', icon: CalendarClock },
    { path: '/announcements', label: 'Bulk Announcements', icon: Megaphone },
    { path: '/reports', label: 'Reports & Export', icon: FileSpreadsheet },
    { path: '/audit-logs', label: 'Audit Trail', icon: History },
    { path: '/whatsapp', label: 'WhatsApp & Simulator', icon: MessageSquare, badge: 'Live / Sim' }
  ];

  const go = (path: string) => {
    onNavigate(path);
    onCloseMobile?.();
  };

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-950/60 md:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 max-w-[85vw] bg-slate-900 text-slate-300 flex flex-col shrink-0 min-h-screen border-r border-slate-800 select-none transform transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
      {/* Brand Header */}
      <div className="p-5 border-b border-slate-800 flex items-center gap-3">
        <div className="flex-1 flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-xl bg-brand-500 flex items-center justify-center text-slate-950 font-bold shadow-md shadow-brand-500/20">
          <ShieldCheck className="w-5 h-5 text-slate-950" />
        </div>
          <div className="min-w-0">
            <h1 className="font-bold text-white text-base tracking-tight leading-none">HostelOS</h1>
            <p className="text-[11px] text-slate-400 mt-1 font-medium">Digital Hostel & Security</p>
          </div>
        </div>
        <button
          onClick={onCloseMobile}
          className="md:hidden min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-800"
          aria-label="Close navigation"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Quick Action: QR Scan Button */}
      <div className="p-4">
        <button
          onClick={() => { onOpenScanner(); onCloseMobile?.(); }}
          className="w-full min-h-[44px] flex items-center justify-center gap-2 py-2.5 px-3 bg-brand-500 hover:bg-brand-600 text-slate-950 font-semibold rounded-xl text-xs transition shadow-sm"
        >
          <QrCode className="w-4 h-4 text-slate-950" />
          Verify Student Pass
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto custom-scrollbar">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPath === item.path;

          return (
            <button
              key={item.path}
              onClick={() => go(item.path)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-slate-800 text-white font-semibold shadow-inner'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-3 truncate">
                <Icon className={`w-4 h-4 ${isActive ? 'text-brand-400' : item.color || 'text-slate-400'}`} />
                <span className="truncate">{item.label}</span>
              </div>
              {item.badge && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-brand-500/20 text-brand-400 border border-brand-500/30">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Admin User Footer */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-semibold text-brand-400 shrink-0">
              {user?.full_name ? user.full_name.charAt(0) : 'A'}
            </div>
            <div className="truncate text-xs">
              <p className="font-semibold text-slate-200 truncate">{user?.full_name || 'Administrator'}</p>
              <p className="text-slate-400 text-[11px] truncate">@{user?.username || 'admin'}</p>
            </div>
          </div>
          <button
            onClick={logout}
            title="Log out"
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
      </aside>
    </>
  );
};
