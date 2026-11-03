import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { Payment } from '@hostel/shared';
import { CreditCard, CheckCircle2, XCircle, Search, Filter, ShieldCheck, DollarSign } from 'lucide-react';
import { StatusBadge } from '../components/StatusBadge.js';
import { Modal } from '../components/Modal.js';

export const PaymentsPage: React.FC = () => {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [transactions, setTransactions] = useState<any[]>([]);

  // Actions
  const [verifyingPayment, setVerifyingPayment] = useState<Payment | null>(null);
  const [verifyNotes, setVerifyNotes] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  const [rejectingPayment, setRejectingPayment] = useState<Payment | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);

  const loadPayments = async () => {
    setIsLoading(true);
    try {
      const [res, txnRes] = await Promise.all([api.getPayments(statusFilter !== 'ALL' ? statusFilter : undefined), api.getDemoTransactions()]);
      setPayments(res.payments);
      setTransactions(txnRes.transactions);
    } catch (err) {
      console.error('Failed to load payments:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPayments();
  }, [statusFilter]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyingPayment) return;
    setIsVerifying(true);
    try {
      await api.verifyPayment(verifyingPayment.id, verifyNotes.trim() || undefined);
      setVerifyingPayment(null);
      setVerifyNotes('');
      await loadPayments();
    } catch (err: any) {
      alert(err.message || 'Failed to verify payment');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingPayment || !rejectReason.trim()) return;
    setIsRejecting(true);
    try {
      await api.rejectPayment(rejectingPayment.id, rejectReason.trim());
      setRejectingPayment(null);
      setRejectReason('');
      await loadPayments();
    } catch (err: any) {
      alert(err.message || 'Failed to reject payment');
    } finally {
      setIsRejecting(false);
    }
  };

  const filtered = payments.filter((p) => {
    if (search) {
      const s = search.toLowerCase();
      const nameMatch = p.student_name?.toLowerCase().includes(s);
      const phoneMatch = p.student_phone?.includes(s);
      const refMatch = p.reference_code.toLowerCase().includes(s);
      const grpMatch = p.group_code?.toLowerCase().includes(s);
      if (!nameMatch && !phoneMatch && !refMatch && !grpMatch) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Student Payments & Manager Verification</h2>
        <p className="text-xs text-slate-500 mt-1">
          Every student pays individually. Deposits are manually inspected and verified by the manager before room allocation is finalized.
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900"><strong>DEMO reconciliation workspace — NO REAL MONEY.</strong> Incoming records below are synthetic bank transactions. A manager must reconcile an exact payment reference and amount; screenshots or claims are not proof of payment.</div>

      {/* Filter Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-4 shadow-sm">
        <div className="relative flex-1 min-w-[280px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by student name, reference code, group code..."
            className="w-full pl-9 pr-3.5 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs font-semibold text-slate-600">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-xl bg-slate-50 font-medium"
          >
            <option value="ALL">All Payment Statuses</option>
            <option value="PENDING">Pending Verification</option>
            <option value="VERIFIED">Verified / Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b"><h3 className="font-bold text-sm">Incoming Demo Bank Transactions</h3></div>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500 uppercase"><tr><th className="p-3">Bank transaction</th><th className="p-3">Payment reference / student</th><th className="p-3">Amount</th><th className="p-3">Beneficiary</th><th className="p-3">Status</th><th className="p-3"></th></tr></thead><tbody>
          {transactions.map(txn => <tr key={txn.id} className="border-t"><td className="p-3 font-mono">{txn.bank_transaction_reference}<br/><span className="text-slate-400">{new Date(txn.transaction_timestamp).toLocaleString()}</span></td><td className="p-3">{txn.payment_reference}<br/><span className="text-slate-500">{txn.student_name || 'No proposed payment'}</span></td><td className="p-3 font-semibold">${txn.amount} {txn.currency}</td><td className="p-3">{txn.beneficiary_account}</td><td className="p-3"><StatusBadge status={txn.reconciliation_status} size="sm" /><p className="text-rose-600">{txn.exception_reason}</p></td><td className="p-3 text-right">{txn.reconciliation_status === 'PENDING_RECONCILIATION' && <div className="flex gap-1 justify-end"><button onClick={async () => { try { await api.reconcileDemoTransaction(txn.id); await loadPayments(); } catch (e: any) { alert(e.message); await loadPayments(); } }} className="px-2 py-1 bg-emerald-600 text-white rounded">Reconcile & Verify</button><button onClick={async () => { const reason = window.prompt('Exception/rejection reason'); if (reason) { await api.rejectDemoTransaction(txn.id, reason); await loadPayments(); } }} className="px-2 py-1 bg-slate-100 rounded">Flag</button></div>}</td></tr>)}
        </tbody></table></div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase">
              <tr>
                <th className="py-3 px-4">Student</th>
                <th className="py-3 px-4">Group Code</th>
                <th className="py-3 px-4">Amount</th>
                <th className="py-3 px-4">Reference Code</th>
                <th className="py-3 px-4">Payment Status</th>
                <th className="py-3 px-4">Notes / Verified At</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/50 transition">
                  <td className="py-3 px-4">
                    <p className="font-bold text-slate-900">{p.student_name}</p>
                    <p className="text-[11px] text-slate-500 font-mono">{p.student_phone}</p>
                  </td>
                  <td className="py-3 px-4 font-mono font-semibold text-slate-700">
                    {p.group_code}
                  </td>
                  <td className="py-3 px-4 font-bold text-slate-900 text-sm">
                    ${p.amount.toLocaleString()} <span className="text-[10px] text-slate-400 font-normal">{p.currency}</span>
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-600 text-[11px]">
                    {p.reference_code}
                  </td>
                  <td className="py-3 px-4">
                    <StatusBadge status={p.status} size="sm" />
                  </td>
                  <td className="py-3 px-4 text-slate-500 text-[11px] max-w-xs truncate">
                    {p.status === 'VERIFIED' ? (
                      <span>Verified: {p.verified_at ? new Date(p.verified_at).toLocaleDateString() : 'Yes'} ({p.notes || 'No notes'})</span>
                    ) : p.notes ? (
                      p.notes
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    {p.status === 'PENDING' ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => {
                            setVerifyingPayment(p);
                            setVerifyNotes('Manual bursary receipt confirmed');
                          }}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition"
                        >
                          Verify
                        </button>
                        <button
                          onClick={() => setRejectingPayment(p)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-rose-50 hover:text-rose-700 text-slate-700 rounded-lg text-xs font-medium transition"
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-400 font-medium">Logged</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Verify Modal */}
      <Modal
        isOpen={!!verifyingPayment}
        onClose={() => setVerifyingPayment(null)}
        title="Verify Student Individual Payment"
        maxWidth="sm"
      >
        {verifyingPayment && (
          <form onSubmit={handleVerify} className="space-y-4">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 space-y-1">
              <p><strong>Student:</strong> {verifyingPayment.student_name}</p>
              <p><strong>Group:</strong> {verifyingPayment.group_code}</p>
              <p><strong>Amount:</strong> ${verifyingPayment.amount} {verifyingPayment.currency}</p>
              <p><strong>Ref Code:</strong> <span className="font-mono">{verifyingPayment.reference_code}</span></p>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
                Verification Notes / Bank Receipt Ref (DEMO)
              </label>
              <input
                type="text"
                value={verifyNotes}
                onChange={(e) => setVerifyNotes(e.target.value)}
                placeholder="e.g. Bank slip confirmed, Teller #9482"
                className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setVerifyingPayment(null)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isVerifying}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition"
              >
                {isVerifying ? 'Verifying...' : 'Confirm Verification'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Reject Modal */}
      <Modal
        isOpen={!!rejectingPayment}
        onClose={() => setRejectingPayment(null)}
        title="Reject Student Payment Record"
        maxWidth="sm"
      >
        {rejectingPayment && (
          <form onSubmit={handleReject} className="space-y-4">
            <p className="text-xs text-slate-500">
              Rejecting payment for <strong>{rejectingPayment.student_name}</strong>. Please provide a clear reason for the audit log.
            </p>

            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
                Rejection Reason
              </label>
              <input
                type="text"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Unverified bank transfer reference, invalid receipt image"
                className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRejectingPayment(null)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isRejecting || !rejectReason.trim()}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold transition disabled:opacity-50"
              >
                {isRejecting ? 'Rejecting...' : 'Reject Payment'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
