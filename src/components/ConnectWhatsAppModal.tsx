import React, { useState } from 'react';
import { X, Copy, Check, MessageSquare, ExternalLink, Smartphone, Zap, Sparkles } from 'lucide-react';

interface ConnectWhatsAppModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ConnectWhatsAppModal: React.FC<ConnectWhatsAppModalProps> = ({ isOpen, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'twilio' | 'meta'>('twilio');

  if (!isOpen) return null;

  const currentHost = typeof window !== 'undefined' ? window.location.origin : 'https://your-app-url.run.app';
  const webhookUrl = `${currentHost}/api/whatsapp-webhook`;

  const handleCopy = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-[#0B141A] text-white rounded-t-2xl">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-xl bg-[#00A884] flex items-center justify-center text-white shadow-sm">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold flex items-center gap-2">
                Connect Bot to Real WhatsApp
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Webhook Ready
                </span>
              </h2>
              <p className="text-xs text-slate-400">Receive resume scores directly inside your phone's WhatsApp chat</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 text-slate-800">
          {/* Webhook Endpoint Box */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
            <label className="text-xs font-bold text-slate-700 block uppercase tracking-wider">
              Your Live Webhook Endpoint
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={webhookUrl}
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono text-slate-800 select-all focus:outline-hidden"
              />
              <button
                onClick={handleCopy}
                className="px-3 py-2 rounded-lg bg-[#00A884] hover:bg-[#009373] text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              This endpoint handles incoming WhatsApp messages and automatically evaluates resumes via Gemini AI.
            </p>
          </div>

          {/* Provider Tabs */}
          <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
            <button
              onClick={() => setActiveTab('twilio')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                activeTab === 'twilio'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Option 1: Twilio Sandbox (Fastest - 2 Mins)
            </button>
            <button
              onClick={() => setActiveTab('meta')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                activeTab === 'meta'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Option 2: Meta Cloud API (Official)
            </button>
          </div>

          {activeTab === 'twilio' ? (
            <div className="space-y-3 text-xs leading-relaxed">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-emerald-50/60 border border-emerald-200 text-emerald-900">
                <Zap className="h-5 w-5 text-[#00A884] shrink-0 mt-0.5" />
                <div>
                  <strong className="block font-bold">Quickest Way to Test in Real WhatsApp</strong>
                  Twilio offers a free WhatsApp sandbox that lets you send messages from your personal phone right away without business verification.
                </div>
              </div>

              <ol className="list-decimal list-inside space-y-2.5 text-slate-700 pl-1">
                <li>
                  Go to <a href="https://console.twilio.com/" target="_blank" rel="noreferrer" className="text-[#00A884] underline font-semibold">Twilio Console</a> and sign up for a free account.
                </li>
                <li>
                  Navigate to <strong>Messaging</strong> &gt; <strong>Try WhatsApp Sandbox</strong>.
                </li>
                <li>
                  Open your real WhatsApp on your phone and send the join code (e.g. <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-900 font-bold">join [your-code]</code>) to Twilio's WhatsApp number.
                </li>
                <li>
                  In your Twilio Sandbox Settings, paste your webhook URL:
                  <div className="bg-slate-100 p-2 rounded-lg font-mono text-[11px] my-1 text-slate-800">
                    WHEN A MESSAGE COMES IN: <strong>{webhookUrl}</strong> (HTTP POST)
                  </div>
                </li>
                <li>
                  <strong>Done!</strong> Now send any resume text or question in your real WhatsApp, and your ATS Screener will reply instantly inside WhatsApp!
                </li>
              </ol>
            </div>
          ) : (
            <div className="space-y-3 text-xs leading-relaxed">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-blue-50/60 border border-blue-200 text-blue-900">
                <Smartphone className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="block font-bold">Meta WhatsApp Business Platform</strong>
                  Official API for enterprise production deployments with verified phone numbers.
                </div>
              </div>

              <ol className="list-decimal list-inside space-y-2.5 text-slate-700 pl-1">
                <li>
                  Go to <a href="https://developers.facebook.com/" target="_blank" rel="noreferrer" className="text-blue-600 underline font-semibold">Meta for Developers</a> and create an app with the <strong>WhatsApp</strong> product.
                </li>
                <li>
                  Under <strong>WhatsApp &gt; Configuration &gt; Webhook</strong>, click <strong>Edit</strong>.
                </li>
                <li>
                  Paste Callback URL: <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-900 font-bold">{webhookUrl}</code>
                </li>
                <li>
                  Verify Token: <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-900 font-bold">ats_bot_token_123</code>
                </li>
                <li>
                  Subscribe to the <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-900">messages</code> field. You can now chat with the Meta test number from your personal WhatsApp!
                </li>
              </ol>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex items-center justify-between">
          <span className="text-[11px] text-slate-500 flex items-center gap-1">
            <Sparkles className="h-3.5 w-3.5 text-[#00A884]" />
            Powered by Gemini AI 5-factor scoring
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            Got It
          </button>
        </div>
      </div>
    </div>
  );
};
