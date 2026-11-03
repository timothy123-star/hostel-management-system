import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { QrCode, ShieldAlert, ShieldCheck, Camera, CheckCircle2, XCircle, Search, RefreshCw, Eye } from 'lucide-react';
import { StatusBadge } from '../components/StatusBadge.js';
import { Modal } from '../components/Modal.js';
import { QRScannerModal } from '../components/QRScannerModal.js';

export const QRIdentityPage: React.FC = () => {
  const [credentials, setCredentials] = useState<any[]>([]);
  const [accessLogs, setAccessLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modals
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [previewQR, setPreviewQR] = useState<any | null>(null);
  const [revokingQR, setRevokingQR] = useState<any | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [isRevoking, setIsRevoking] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [credsRes, logsRes] = await Promise.all([
        api.getQRCredentials(),
        api.getAccessLogs()
      ]);
      setCredentials(credsRes.credentials);
      setAccessLogs(logsRes.accessLogs);
    } catch (err) {
      console.error('Failed to load QR credential data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRevoke = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revokingQR || !revokeReason.trim()) return;
    setIsRevoking(true);
    try {
      await api.revokeQR(revokingQR.id, revokeReason.trim());
      setRevokingQR(null);
      setRevokeReason('');
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to revoke QR credential');
    } finally {
      setIsRevoking(false);
    }
  };

  const handleReactivate = async (credentialId: string) => {
    try {
      await api.reactivateQR(credentialId);
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to reactivate QR credential');
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">QR Digital Identity Passes</h2>
          <p className="text-xs text-slate-500 mt-1">
            Issued only after verified payments and room allocations. Unpredictable cryptographic tokens are hashed and validated without exposing student details.
          </p>
        </div>

        <button
          onClick={() => setIsScannerOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-brand-500 hover:bg-brand-600 text-slate-950 font-semibold rounded-xl text-xs shadow-sm transition"
        >
          <Camera className="w-4 h-4 text-slate-950" />
          Launch Gate QR Scanner
        </button>
      </div>

      {/* Security Architecture Info Banner */}
      <div className="bg-slate-900 text-white rounded-2xl p-5 border border-slate-800 flex items-start gap-3.5 text-xs">
        <ShieldCheck className="w-5 h-5 text-brand-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-bold text-white text-sm">Cryptographic Gate Identity Protocol</p>
          <p className="text-slate-300">
            • QR payloads contain only an unpredictable 32-byte cryptographic token.<br />
            • Student personal information, phone number, and room numbers are never directly encoded in plain text within the QR image.<br />
            • The gate scanner hashes incoming tokens with SHA-256 and matches against the database in real-time.<br />
            • Digital passes can be instantly revoked by management for clearance holds.
          </p>
        </div>
      </div>

      {/* Digital Credentials Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
            <QrCode className="w-4 h-4 text-slate-500" />
            Active & Issued Digital Passes
          </h3>
          <span className="text-xs text-slate-500">{credentials.length} Passes Minted</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase">
              <tr>
                <th className="py-3 px-4">Student</th>
                <th className="py-3 px-4">Room & Facility</th>
                <th className="py-3 px-4">Pass Status</th>
                <th className="py-3 px-4">Token SHA-256 Hash</th>
                <th className="py-3 px-4">Issued At</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {credentials.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/50 transition">
                  <td className="py-3 px-4">
                    <p className="font-bold text-slate-900">{c.student_name}</p>
                    <p className="text-[11px] text-slate-500 font-mono">{c.phone_number}</p>
                  </td>
                  <td className="py-3 px-4">
                    <span className="font-semibold text-slate-900">Room {c.room_number}</span>
                    <p className="text-[11px] text-slate-500">{c.hostel_name}</p>
                  </td>
                  <td className="py-3 px-4">
                    <StatusBadge status={c.status} size="sm" />
                    {c.revoke_reason && (
                      <p className="text-[10px] text-rose-600 mt-0.5 truncate max-w-[160px]">{c.revoke_reason}</p>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono text-[11px] text-slate-500 max-w-xs truncate">
                    {c.token_hash}
                  </td>
                  <td className="py-3 px-4 text-slate-500 text-[11px]">
                    {new Date(c.issued_at).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => setPreviewQR(c)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold transition"
                      >
                        <Eye className="w-3 h-3" /> View QR
                      </button>
                      {c.status === 'ACTIVE' ? (
                        <button
                          onClick={() => {
                            setRevokingQR(c);
                            setRevokeReason('');
                          }}
                          className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-semibold transition"
                        >
                          Revoke
                        </button>
                      ) : c.status === 'REVOKED' ? (
                        <button
                          onClick={() => handleReactivate(c.id)}
                          className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold transition"
                        >
                          Reactivate
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Security Gate Access Logs Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-slate-500" />
            Gate Security Verification Logs
          </h3>
          <span className="text-xs text-slate-500">Live Checkpoint Audit</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase">
              <tr>
                <th className="py-3 px-4">Verification Time</th>
                <th className="py-3 px-4">Student</th>
                <th className="py-3 px-4">Method</th>
                <th className="py-3 px-4">Gate Outcome</th>
                <th className="py-3 px-4">Reason / Details</th>
                <th className="py-3 px-4">Verified By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {accessLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/50 transition">
                  <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                    {new Date(log.logged_at).toLocaleString()}
                  </td>
                  <td className="py-3 px-4 font-bold text-slate-900">
                    {log.student_name || 'Unrecognised Token Holder'}
                  </td>
                  <td className="py-3 px-4 font-mono text-[11px] text-slate-600">
                    {log.verification_method}
                  </td>
                  <td className="py-3 px-4">
                    <StatusBadge status={log.outcome} size="sm" />
                  </td>
                  <td className="py-3 px-4 text-slate-600 max-w-xs truncate">
                    {log.reason || '—'}
                  </td>
                  <td className="py-3 px-4 text-slate-500">
                    @{log.verified_by_username || 'manager'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* QR Code Preview Modal */}
      <Modal
        isOpen={!!previewQR}
        onClose={() => setPreviewQR(null)}
        title={`Digital Identity Pass — ${previewQR?.student_name}`}
        maxWidth="sm"
      >
        {previewQR && (
          <div className="flex flex-col items-center text-center space-y-4">
            {previewQR.qr_image_data ? (
              <img
                src={previewQR.qr_image_data}
                alt="QR Code"
                className="w-56 h-56 rounded-2xl bg-white border border-slate-200 p-2 shadow-md"
              />
            ) : (
              <div className="w-56 h-56 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">
                No image data
              </div>
            )}

            <div className="space-y-1">
              <h4 className="font-bold text-base text-slate-900">{previewQR.student_name}</h4>
              <p className="text-xs text-slate-600">
                {previewQR.hostel_name} • Room {previewQR.room_number}
              </p>
              <StatusBadge status={previewQR.status} size="sm" />
            </div>

            <p className="text-[11px] text-slate-400 font-mono break-all px-2">
              Hash: {previewQR.token_hash}
            </p>
          </div>
        )}
      </Modal>

      {/* Revoke Pass Modal */}
      <Modal
        isOpen={!!revokingQR}
        onClose={() => setRevokingQR(null)}
        title={`Revoke Digital Pass — ${revokingQR?.student_name}`}
        maxWidth="sm"
      >
        {revokingQR && (
          <form onSubmit={handleRevoke} className="space-y-4">
            <p className="text-xs text-slate-500">
              Revoking this credential will immediately block access at all security checkpoints for <strong>{revokingQR.student_name}</strong>.
            </p>

            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
                Revocation Reason (Audit Log Required)
              </label>
              <input
                type="text"
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="e.g. Disciplinary hold, clearance suspension"
                className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRevokingQR(null)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-medium text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isRevoking || !revokeReason.trim()}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold transition disabled:opacity-50"
              >
                {isRevoking ? 'Revoking...' : 'Confirm Revocation'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Live Scanner Modal */}
      <QRScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onVerificationComplete={loadData}
      />
    </div>
  );
};
