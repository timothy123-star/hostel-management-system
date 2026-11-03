import React from 'react';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md' }) => {
  const s = status.toUpperCase().replace(/\s+/g, '_');

  let colorClasses = 'bg-slate-100 text-slate-700 border-slate-200';

  // Green / Success
  if (['VERIFIED', 'ACTIVE', 'GRANTED', 'AVAILABLE', 'ALLOCATED', 'DELIVERED', 'SENT'].includes(s)) {
    colorClasses = 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }
  // Amber / Pending / Warning
  else if (['PENDING', 'PENDING_REVIEW', 'HOLD', 'FORMING', 'WAITING', 'QUEUED', 'WARNING_14_DAYS', 'NOTICE_30_DAYS'].includes(s)) {
    colorClasses = 'bg-amber-50 text-amber-700 border-amber-200';
  }
  // Blue / Info / Ready
  else if (['READY_FOR_ALLOCATION', 'MATCHED', 'UPCOMING', 'SIMULATED'].includes(s)) {
    colorClasses = 'bg-blue-50 text-blue-700 border-blue-200';
  }
  // Red / Danger / Critical
  else if (['REJECTED', 'REVOKED', 'EXPIRED', 'DENIED', 'CRITICAL_7_DAYS', 'FAILED', 'OCCUPIED'].includes(s)) {
    colorClasses = 'bg-rose-50 text-rose-700 border-rose-200';
  }
  // Purple / Maintenance / Moved
  else if (['MAINTENANCE', 'MOVED', 'CANCELLED'].includes(s)) {
    colorClasses = 'bg-purple-50 text-purple-700 border-purple-200';
  }

  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs font-semibold';

  return (
    <span className={`inline-flex items-center rounded-full border ${sizeClasses} ${colorClasses}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
};
