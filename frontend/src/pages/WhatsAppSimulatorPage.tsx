import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api/client.js';
import {
  MessageSquare,
  Send,
  Phone,
  RefreshCw,
  QrCode,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  BookOpen,
  Info,
  ShieldCheck,
  Smartphone
} from 'lucide-react';
import { WhatsAppProviderStatus } from '@hostel/shared';

export const WhatsAppSimulatorPage: React.FC = () => {
  const [status, setStatus] = useState<WhatsAppProviderStatus | null>(null);
  const [currentPhone, setCurrentPhone] = useState('+15551001001'); // Default to John Doe
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [inboxFailures, setInboxFailures] = useState<{ failed_count: number; failures: any[] } | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const demoContacts = [
    { name: 'John Doe (Allocated, Active Pass)', phone: '+15551001001' },
    { name: 'Sarah Connor (Double Room Pair)', phone: '+15552002001' },
    { name: 'Alex Hunter (Triple Pair Leader)', phone: '+15553003001' },
    { name: 'Chloe Bennett (Waiting for Roommate)', phone: '+15554004001' },
    { name: 'New Student (Unregistered)', phone: '+15559990001' }
  ];

  const loadStatusAndHistory = async () => {
    try {
      const [statusRes, historyRes] = await Promise.all([
        api.getWhatsAppStatus(),
        api.getSimulatorHistory(currentPhone)
      ]);
      setStatus(statusRes.status);
      setMessages(historyRes.history.reverse());
    } catch (err) {
      console.error('Failed to load WhatsApp simulator data:', err);
    }
    try {
      const failuresRes = await api.getInboxFailures(20, 0);
      setInboxFailures({ failed_count: failuresRes.failed_count, failures: failuresRes.failures });
    } catch {
      // Inbox failure view is operational-only; simulator stays usable offline.
      setInboxFailures(null);
    }
  };

  useEffect(() => {
    loadStatusAndHistory();
    const interval = setInterval(loadStatusAndHistory, 3000);
    return () => clearInterval(interval);
  }, [currentPhone]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async (textToSend?: string, buttonId?: string) => {
    const text = textToSend || inputText;
    if (!text && !buttonId) return;

    setIsSending(true);
    setInputText('');

    // Optimistically add user bubble
    const userMsg = {
      id: `local-${Date.now()}`,
      to: currentPhone,
      direction: 'INBOUND',
      text: text || buttonId,
      timestamp: new Date().toISOString()
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      await api.sendSimulatorMessage({
        from: currentPhone,
        textBody: text,
        buttonId
      });
      // Fetch immediate responses
      const res = await api.getSimulatorHistory(currentPhone);
      setMessages(res.history.reverse());
    } catch (err: any) {
      alert(err.message || 'Error processing simulator message');
    } finally {
      setIsSending(false);
    }
  };

  const handleClearHistory = async () => {
    try {
      await api.clearSimulatorHistory();
      setMessages([]);
    } catch (err) {
      alert('Failed to clear history');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
            WhatsApp Assistant & Simulator
          </h2>
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase ${
            status?.is_live
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-amber-50 text-amber-700 border border-amber-200'
          }`}>
            {status?.is_live ? 'Connected to Meta Cloud API' : 'Simulator Mode Active'}
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          {status?.is_live
            ? 'Live official Meta WhatsApp Business Cloud API adapter connected and processing production webhooks.'
            : 'Safe local simulation environment running identical production booking, roommate matching, and QR issuance logic.'}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Interactive Phone Simulator */}
        <div className="lg:col-span-7 flex justify-center">
          <div className="w-full max-w-md bg-slate-900 rounded-[40px] p-4 shadow-2xl border-4 border-slate-800 relative">
            {/* Phone Notch */}
            <div className="w-32 h-4 bg-slate-800 rounded-full mx-auto mb-3" />

            {/* Simulated Phone Screen */}
            <div className="bg-[#e5ddd5] rounded-[28px] overflow-hidden flex flex-col h-[min(640px,72dvh)] min-h-[420px] shadow-inner relative">
              {/* WhatsApp App Header */}
              <div className="bg-[#075e54] text-white px-4 py-3 flex items-center justify-between shadow-md shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-700 flex items-center justify-center font-bold text-sm shadow-inner">
                    🏛️
                  </div>
                  <div>
                    <h4 className="font-semibold text-sm leading-tight">Hostel Assistant</h4>
                    <p className="text-[11px] text-emerald-200 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      {status?.is_live ? 'Official Meta API' : 'SIMULATION MODE'}
                    </p>
                  </div>
                </div>

                <button
                  onClick={handleClearHistory}
                  title="Clear chat history"
                  className="p-1 rounded text-emerald-100 hover:text-white text-xs hover:bg-emerald-800/40"
                >
                  Clear
                </button>
              </div>

              {/* Chat Message Scroll Area */}
              <div
                ref={chatScrollRef}
                className="flex-1 p-4 overflow-y-auto custom-scrollbar space-y-3 text-xs"
              >
                {/* Greeting / Simulation Notice */}
                <div className="p-2.5 rounded-xl bg-amber-100/90 border border-amber-300/80 text-amber-900 text-[11px] text-center shadow-sm">
                  <span className="font-bold">WhatsApp Simulator:</span> You are communicating as phone number <strong className="font-mono">{currentPhone}</strong>.
                </div>

                {messages.length === 0 && (
                  <div className="text-center py-12 text-slate-500 italic text-[11px]">
                    No messages yet. Click <strong>MENU</strong>, <strong>QR</strong>, or type <strong>BOOK</strong> below to begin.
                  </div>
                )}

                {messages.map((m, idx) => {
                  const isInbound = m.direction === 'INBOUND';

                  return (
                    <div
                      key={m.id || idx}
                      className={`flex flex-col ${isInbound ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 shadow-sm text-slate-900 whitespace-pre-line ${
                          isInbound
                            ? 'bg-[#dcf8c6] rounded-tr-none'
                            : 'bg-white rounded-tl-none border border-slate-200/60'
                        }`}
                      >
                        {/* Text Body */}
                        {m.text && <p className="leading-relaxed">{m.text}</p>}

                        {/* Image / QR Image Message */}
                        {m.imageUrl && (
                          <div className="mt-1 space-y-1.5">
                            <img
                              src={m.imageUrl}
                              alt="Pass QR"
                              className="w-48 h-48 rounded-xl bg-white p-2 border border-slate-200 mx-auto shadow-sm"
                            />
                            {m.caption && <p className="text-[11px] text-slate-800 font-medium">{m.caption}</p>}
                          </div>
                        )}

                        {/* Interactive Buttons (Rendered inside bubble) */}
                        {m.buttons && m.buttons.length > 0 && (
                          <div className="mt-2.5 pt-2 border-t border-slate-100 space-y-1.5">
                            {m.buttons.map((b: any) => (
                              <button
                                key={b.id}
                                onClick={() => handleSendMessage(undefined, b.id)}
                                className="w-full py-1.5 px-3 bg-slate-50 hover:bg-slate-100 text-brand-700 font-semibold rounded-lg text-xs border border-brand-200 text-center transition block shadow-xs"
                              >
                                {b.title}
                              </button>
                            ))}
                          </div>
                        )}

                        <span className="text-[9px] text-slate-400 block text-right mt-1">
                          {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Quick Preset Buttons Bar */}
              <div className="px-3 py-1.5 bg-slate-100/90 border-t border-slate-200 flex items-center gap-1.5 overflow-x-auto text-[11px]">
                <button
                  onClick={() => handleSendMessage('MENU')}
                  className="min-h-[44px] px-2 py-1 bg-white hover:bg-slate-200 rounded-md font-semibold text-slate-700 border shrink-0"
                >
                  MENU
                </button>
                <button
                  onClick={() => handleSendMessage('QR')}
                  className="min-h-[44px] px-2 py-1 bg-brand-50 hover:bg-brand-100 rounded-md font-semibold text-brand-800 border border-brand-200 shrink-0"
                >
                  Show QR
                </button>
                <button
                  onClick={() => handleSendMessage('BOOK')}
                  className="min-h-[44px] px-2 py-1 bg-white hover:bg-slate-200 rounded-md font-semibold text-slate-700 border shrink-0"
                >
                  BOOK
                </button>
                <button
                  onClick={() => handleSendMessage('STATUS')}
                  className="min-h-[44px] px-2 py-1 bg-white hover:bg-slate-200 rounded-md font-semibold text-slate-700 border shrink-0"
                >
                  STATUS
                </button>
                <button
                  onClick={() => handleSendMessage('HELP')}
                  className="min-h-[44px] px-2 py-1 bg-white hover:bg-slate-200 rounded-md font-semibold text-slate-700 border shrink-0"
                >
                  HELP
                </button>
              </div>

              {/* Message Input Box */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="bg-[#f0f0f0] p-2.5 flex items-center gap-2 border-t border-slate-200"
              >
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Type a message or command (e.g. QR, BOOK, MENU)..."
                  className="flex-1 bg-white px-3.5 py-2 text-xs rounded-full border border-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
                <button
                  type="submit"
                  disabled={isSending || !inputText.trim()}
                  className="w-8 h-8 rounded-full bg-[#075e54] text-white flex items-center justify-center shrink-0 hover:bg-[#064e46] transition disabled:opacity-50 shadow-sm"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* Right Column: Controls & Meta Configuration */}
        <div className="lg:col-span-5 space-y-6">
          {/* Active Sender Selector Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
              <Phone className="w-4 h-4 text-slate-500" />
              Simulated Sender Phone Number
            </h3>
            <p className="text-xs text-slate-500">
              Select an existing student contact or type your own mobile number to test the full booking, allocation, and QR workflow:
            </p>

            <div className="space-y-2">
              {demoContacts.map((contact) => (
                <button
                  key={contact.phone}
                  onClick={() => setCurrentPhone(contact.phone)}
                  className={`w-full text-left px-3.5 py-2 rounded-xl text-xs flex items-center justify-between border transition ${
                    currentPhone === contact.phone
                      ? 'bg-slate-900 text-white font-semibold border-slate-900 shadow-sm'
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                >
                  <span className="truncate">{contact.name}</span>
                  <span className={`font-mono text-[11px] shrink-0 ${currentPhone === contact.phone ? 'text-brand-400' : 'text-slate-400'}`}>
                    {contact.phone}
                  </span>
                </button>
              ))}
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase text-slate-500 mb-1">
                Custom Phone Number
              </label>
              <input
                type="text"
                value={currentPhone}
                onChange={(e) => setCurrentPhone(e.target.value)}
                placeholder="+1555..."
                className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Meta Cloud API Configuration Checklist */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-slate-500" />
                Meta Cloud API Integration Status
              </h3>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                status?.is_live
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border border-amber-200'
              }`}>
                {status?.provider_name}
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50">
                <span className="text-slate-600 font-mono text-[11px]">META_WHATSAPP_ACCESS_TOKEN</span>
                {status?.access_token_configured ? (
                  <span className="text-emerald-600 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Configured
                  </span>
                ) : (
                  <span className="text-slate-400 italic">Not set (Simulator fallback)</span>
                )}
              </div>

              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50">
                <span className="text-slate-600 font-mono text-[11px]">META_WHATSAPP_PHONE_NUMBER_ID</span>
                {status?.phone_number_id_configured ? (
                  <span className="text-emerald-600 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Configured
                  </span>
                ) : (
                  <span className="text-slate-400 italic">Not set</span>
                )}
              </div>

              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50">
                <span className="text-slate-600 font-mono text-[11px]">META_WHATSAPP_APP_SECRET</span>
                {status?.app_secret_configured ? (
                  <span className="text-emerald-600 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Configured
                  </span>
                ) : (
                  <span className="text-slate-400 italic">Not set</span>
                )}
              </div>

              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50">
                <span className="text-slate-600 font-mono text-[11px]">META_WHATSAPP_VERIFY_TOKEN</span>
                <span className="text-emerald-600 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Configured
                </span>
              </div>
            </div>

            {/* Live Setup Instructions */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 space-y-1.5">
              <p className="font-semibold text-slate-800">Public Webhook Endpoint for Meta:</p>
              <code className="block bg-white p-2 rounded border border-slate-200 font-mono text-[11px] text-slate-800 select-all">
                {status?.public_base_url || 'http://localhost:4000'}/api/whatsapp/webhook
              </code>
              <p className="text-[11px] text-slate-500">
                Verify Token: <code className="font-mono text-slate-700">hostel_meta_verify_token_demo_2026</code>
              </p>
            </div>
          </div>

          {/* Inbox failures (manager operational view) */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-slate-500" />
                Inbox Delivery Failures
              </h3>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                (inboxFailures?.failed_count ?? 0) > 0
                  ? 'bg-red-50 text-red-700 border border-red-200'
                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              }`}>
                {inboxFailures === null ? 'Unavailable' : `${inboxFailures.failed_count} terminal`}
              </span>
            </div>
            {inboxFailures !== null && inboxFailures.failures.length === 0 && (
              <p className="text-xs text-slate-500">No terminally failed inbound messages. Retryable messages recover automatically.</p>
            )}
            {inboxFailures !== null && inboxFailures.failures.slice(0, 5).map((f: any) => (
              <div key={f.message_id} className="p-2.5 rounded-xl bg-red-50/60 border border-red-200/60 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-slate-700 truncate">{f.message_id}</span>
                  <span className="text-slate-500 shrink-0">{f.attempts} attempts</span>
                </div>
                <p className="text-red-800 break-words">{String(f.last_error || 'Unknown error').slice(0, 200)}</p>
                <p className="text-[11px] text-slate-500">{f.from_number} · {f.updated_at}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
