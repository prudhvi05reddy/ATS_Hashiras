import React, { useState, useEffect } from 'react';
import {
  X,
  Send,
  CheckCircle2,
  ExternalLink,
  Copy,
  Check,
  ShieldCheck,
  Bot,
  Terminal,
  RefreshCw,
  Sparkles,
  MessageSquare,
  AlertCircle
} from 'lucide-react';

interface TelegramConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  appUrl?: string;
}

export const TelegramConnectModal: React.FC<TelegramConnectModalProps> = ({
  isOpen,
  onClose,
  appUrl = window.location.origin,
}) => {
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedTokenHelper, setCopiedTokenHelper] = useState(false);
  const [botToken, setBotToken] = useState('8851904952:AAH-0cFY6odRkho72A_N00Rcblw_LyXfN_E');
  const [webhookUrl, setWebhookUrl] = useState(`${appUrl}/api/telegram/webhook`);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusInfo, setStatusInfo] = useState<{
    isConfigured: boolean;
    botUsername?: string;
    webhookUrl?: string;
  } | null>(null);
  const [settingWebhook, setSettingWebhook] = useState(false);
  const [setResult, setSetResult] = useState<{ success: boolean; message: string } | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simulatedResponse, setSimulatedResponse] = useState<string | null>(null);

  // Load current Telegram Bot status from server
  const fetchStatus = async () => {
    setStatusLoading(true);
    try {
      const res = await fetch('/api/telegram/status');
      if (res.ok) {
        const data = await res.json();
        setStatusInfo(data);
        if (data.webhookUrl) {
          setWebhookUrl(data.webhookUrl);
        }
      }
    } catch (err) {
      console.error('Error checking telegram status:', err);
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchStatus();
    }
  }, [isOpen]);

  const handleCopyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  const handleRegisterWebhook = async () => {
    if (!botToken && !statusInfo?.isConfigured) {
      setSetResult({
        success: false,
        message: 'Please provide your Telegram Bot Token from @BotFather first.',
      });
      return;
    }

    setSettingWebhook(true);
    setSetResult(null);

    try {
      const res = await fetch('/api/telegram/set-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: botToken.trim() || undefined,
          webhookUrl: webhookUrl.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSetResult({
          success: true,
          message: `Telegram Webhook successfully linked to ${webhookUrl}!`,
        });
        fetchStatus();
      } else {
        setSetResult({
          success: false,
          message: data.telegramResponse?.description || data.error || 'Failed to set webhook.',
        });
      }
    } catch (err: any) {
      setSetResult({
        success: false,
        message: err?.message || 'Network error while connecting to Telegram API.',
      });
    } finally {
      setSettingWebhook(false);
    }
  };

  const handleSimulateWebhook = async () => {
    setSimulating(true);
    setSimulatedResponse(null);
    try {
      const res = await fetch('/api/telegram/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '/start',
        }),
      });
      const data = await res.json();
      setSimulatedResponse(data.replyText || 'Received response from simulated bot.');
    } catch (err: any) {
      setSimulatedResponse('Error simulating webhook: ' + err.message);
    } finally {
      setSimulating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
      <div
        id="telegram-connect-modal"
        className="bg-[#17212B] border border-[#2B5278]/60 text-slate-100 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#242F3D] bg-[#0E1621]/80 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#229ED9] to-[#2AABEE] flex items-center justify-center shadow-md">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white">Connect Real Telegram Bot</h2>
                <span className="bg-[#229ED9]/20 text-[#2AABEE] text-[11px] font-semibold px-2 py-0.5 rounded-full border border-[#229ED9]/30">
                  @BotFather
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Link this AI ATS Analyzer directly to your own Telegram Bot
              </p>
            </div>
          </div>
          <button
            id="btn-close-telegram-modal"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-[#242F3D] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 text-sm">
          {/* Status Alert */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-[#2B5278]/40 to-[#17212B] border border-[#2B5278] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-[#229ED9]/15 text-[#2AABEE] shrink-0 mt-0.5">
                <Sparkles className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h4 className="font-semibold text-white">Bot is Live: @ATS_4405_bot</h4>
                  <span className="flex items-center gap-1 text-[11px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-medium">
                    <CheckCircle2 className="w-3 h-3" /> Polling Active
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Your Telegram Bot is running in real-time. You can message it directly on Telegram or use the web interface!
                </p>
              </div>
            </div>
            <a
              href="https://t.me/ATS_4405_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 px-4 py-2 rounded-xl bg-[#229ED9] hover:bg-[#2AABEE] text-white text-xs font-bold flex items-center gap-1.5 shadow-md transition-colors"
            >
              <Send className="w-4 h-4" />
              <span>Open in Telegram</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* 3 Step Setup Guide */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#2AABEE]">
              3 Steps to Run in Official Telegram App
            </h3>

            {/* Step 1 */}
            <div className="p-4 rounded-xl bg-[#0E1621] border border-[#242F3D] space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-[#229ED9] text-white flex items-center justify-center text-xs font-bold">
                    1
                  </span>
                  <span className="font-semibold text-white">Create Bot via @BotFather</span>
                </div>
                <a
                  href="https://t.me/BotFather"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-[#2AABEE] hover:underline"
                >
                  Open @BotFather <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
              <p className="text-xs text-slate-400 pl-8">
                Open Telegram, search for <strong>@BotFather</strong>, send{' '}
                <code className="bg-[#17212B] px-1.5 py-0.5 rounded text-[#2AABEE]">/newbot</code>,
                name your bot (e.g. <em>MyAtsResumeBot</em>), and copy the HTTP API Token.
              </p>
            </div>

            {/* Step 2 */}
            <div className="p-4 rounded-xl bg-[#0E1621] border border-[#242F3D] space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-[#229ED9] text-white flex items-center justify-center text-xs font-bold">
                  2
                </span>
                <span className="font-semibold text-white">Enter Bot Token (Optional for Live Link)</span>
              </div>
              <div className="pl-8 space-y-2">
                <input
                  type="password"
                  placeholder="e.g. 123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#17212B] border border-[#2B5278] text-white placeholder-slate-500 text-xs font-mono focus:outline-hidden focus:border-[#2AABEE]"
                />
                <p className="text-[11px] text-slate-400">
                  Or add <code className="text-slate-200">TELEGRAM_BOT_TOKEN</code> in your environment settings.
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="p-4 rounded-xl bg-[#0E1621] border border-[#242F3D] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-[#229ED9] text-white flex items-center justify-center text-xs font-bold">
                    3
                  </span>
                  <span className="font-semibold text-white">Register Webhook Endpoint</span>
                </div>
                <button
                  id="btn-copy-webhook"
                  onClick={handleCopyWebhook}
                  className="inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-white bg-[#17212B] px-2.5 py-1 rounded-md border border-[#242F3D] transition-colors"
                >
                  {copiedWebhook ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" /> Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" /> Copy Webhook
                    </>
                  )}
                </button>
              </div>
              <div className="pl-8 space-y-3">
                <div className="p-2.5 rounded-lg bg-[#17212B] border border-[#242F3D] text-[11px] font-mono text-slate-300 break-all select-all">
                  {webhookUrl}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    id="btn-set-webhook"
                    onClick={handleRegisterWebhook}
                    disabled={settingWebhook}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#229ED9] hover:bg-[#2AABEE] text-white text-xs font-semibold shadow-md transition-colors disabled:opacity-50"
                  >
                    {settingWebhook ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Registering with Telegram...
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" /> Register Webhook with Telegram
                      </>
                    )}
                  </button>

                  <button
                    id="btn-test-webhook-simulate"
                    onClick={handleSimulateWebhook}
                    disabled={simulating}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#242F3D] hover:bg-[#2B5278] text-slate-200 text-xs font-medium border border-[#2B5278]/50 transition-colors"
                  >
                    <Terminal className="w-3.5 h-3.5 text-[#2AABEE]" /> Test /start Simulation
                  </button>
                </div>

                {setResult && (
                  <div
                    className={`p-3 rounded-lg text-xs flex items-start gap-2 ${
                      setResult.success
                        ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                        : 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
                    }`}
                  >
                    {setResult.success ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    )}
                    <span>{setResult.message}</span>
                  </div>
                )}

                {simulatedResponse && (
                  <div className="p-3 rounded-lg bg-[#17212B] border border-[#2B5278]/60 text-xs space-y-1">
                    <div className="flex items-center gap-1.5 text-[#2AABEE] font-semibold text-[11px]">
                      <MessageSquare className="w-3 h-3" /> Bot Response Preview:
                    </div>
                    <pre className="text-slate-300 font-sans whitespace-pre-wrap leading-relaxed text-[11px]">
                      {simulatedResponse}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-[#242F3D] bg-[#0E1621]/80 flex items-center justify-between">
          <div className="text-xs text-slate-400">
            Endpoint: <code className="text-[#2AABEE]">/api/telegram/webhook</code>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#242F3D] hover:bg-[#2B5278] text-white text-xs font-semibold transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
