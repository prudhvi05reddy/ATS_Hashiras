import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Paperclip,
  Bot,
  Sparkles,
  CheckCheck,
  Check,
  BarChart3,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  Award,
  AlertCircle,
  FileText,
  FileCheck,
  Search,
  Menu,
  X,
  Upload,
  Layers,
  HelpCircle,
  Maximize2,
  Minimize2,
  RefreshCw,
  Terminal,
  Zap,
  Target,
  Briefcase,
  User,
  Users,
  Sliders,
  Share2
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from 'recharts';
import { UploadedDoc, AnalysisResult, CandidateAnalysis } from '../types';
import { readFileAsTextOrBase64 } from '../utils/fileParser';
import { TelegramConnectModal } from './TelegramConnectModal';

export interface TelegramMessage {
  id: string;
  sender: 'user' | 'bot' | 'system';
  text: string;
  timestamp: string;
  chartType?: 'scores' | 'factors' | 'skills' | null;
  inlineKeyboard?: Array<Array<{ text: string; action: string }>>;
  attachment?: {
    name: string;
    type: 'resume' | 'jd';
    size: string;
  };
  scoreCard?: {
    candidates: Array<{
      name: string;
      score: number;
      alignment: string;
      matchedSkills: string[];
      missingSkills: string[];
    }>;
  };
}

interface TelegramBotScreenProps {
  onOpenAtsAnalyzer: () => void;
  onLoadSample: () => void;
  onReset: () => void;
  jobDescription: UploadedDoc | null;
  resumes: UploadedDoc[];
  analysisResult: AnalysisResult | null;
  onSetJobDescription: (doc: UploadedDoc | null) => void;
  onAddResume: (doc: UploadedDoc) => void;
  onRemoveResume: (id: string) => void;
  onRunAnalysis: () => Promise<void>;
  isAnalyzing: boolean;
}

export const TelegramBotScreen: React.FC<TelegramBotScreenProps> = ({
  onOpenAtsAnalyzer,
  onLoadSample,
  onReset,
  jobDescription,
  resumes,
  analysisResult,
  onSetJobDescription,
  onAddResume,
  onRemoveResume,
  onRunAnalysis,
  isAnalyzing,
}) => {
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [inputMessage, setInputMessage] = useState('');
  const [isBotTyping, setIsBotTyping] = useState(false);
  const [botTypingStatus, setBotTypingStatus] = useState('ATS Resume Bot is typing...');
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [showChartPanel, setShowChartPanel] = useState(true);
  const [activeChartTab, setActiveChartTab] = useState<'scores' | 'skills'>('scores');
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initial telegram messages conversation simulating live bot interaction
  const [messages, setMessages] = useState<TelegramMessage[]>([
    {
      id: 'msg-start',
      sender: 'user',
      text: '/start',
      timestamp: '10:00 AM',
    },
    {
      id: 'msg-welcome',
      sender: 'bot',
      text: `👋 **Welcome to ATS Resume Bot!** 🤖\n\nI am your intelligent AI Recruiter & ATS Candidate Screener powered by Google Gemini.\n\n**What I can do for you:**\n• ⚡ **Calculate ATS Match Score (0–100%)**\n• 🎯 **Uncover Missing Keywords & Critical Gaps**\n• 📊 **Evaluate 1 or Multiple Candidate Resumes**\n• 💡 **AI Resume Optimization Booster Tips**\n• ❓ **Auto-generate Tailored Interview Questions**\n\nSelect an option below or send your resume/job description to begin!`,
      timestamp: '10:00 AM',
      inlineKeyboard: [
        [
          { text: '⚡ Run ATS Scan', action: 'cmd_scan' },
          { text: '👥 Compare Both Resumes', action: 'cmd_compare' },
        ],
        [
          { text: '➕ Add JD', action: 'cmd_addjd' },
          { text: '📄 Active Vacancy', action: 'cmd_viewjd' },
        ],
        [
          { text: '📥 Upload Resumes', action: 'cmd_upload' },
          { text: '💡 Booster Tips', action: 'cmd_tips' },
        ],
        [
          { text: '❓ Interview Questions', action: 'cmd_questions' },
        ],
      ],
    },
    {
      id: 'msg-jd-uploaded',
      sender: 'system',
      text: `📄 **Active Job Description Loaded:**\n"Senior Full Stack Engineer (CloudScale Technologies)"\n• Requires: React, Node.js, TypeScript, AWS, Docker, Microservices, 5+ yrs experience.`,
      timestamp: '10:01 AM',
      attachment: {
        name: 'Senior Full Stack Engineer - Job Description.txt',
        type: 'jd',
        size: '2.4 KB',
      },
    },
    {
      id: 'msg-resumes-loaded',
      sender: 'system',
      text: `📥 **Candidate Resumes Loaded for Evaluation:**\n1. Alexander Rivera (Lead Full Stack)\n2. Priya Patel (Frontend Engineer)\n3. Marcus Vance (Junior Developer)`,
      timestamp: '10:01 AM',
    },
    {
      id: 'msg-scan-results',
      sender: 'bot',
      text: `📊 **ATS Screening Results:**\n\n🥇 **Alexander Rivera** — **94/100** 🟢 (Excellent Fit)\n• **Matched**: React, Node.js, TypeScript, Docker, Microservices, GraphQL\n• **Status**: *Strongly Recommend Shortlist*\n\n🥈 **Priya Patel** — **68/100** 🟡 (Strong Fit)\n• **Matched**: React, JavaScript, REST APIs, Tailwind CSS\n• **Gaps**: Docker, Kubernetes, AWS CDK, Distributed Systems\n\n🥉 **Marcus Vance** — **36/100** 🔴 (Weak Fit)\n• **Gaps**: Missing modern full stack & cloud architecture experience\n\n_Tap below to compare resumes side-by-side or inspect radar breakdown._`,
      timestamp: '10:02 AM',
      scoreCard: {
        candidates: [
          {
            name: 'Alexander Rivera',
            score: 94,
            alignment: 'Excellent Fit',
            matchedSkills: ['React', 'Node.js', 'TypeScript', 'Docker', 'GraphQL', 'AWS'],
            missingSkills: ['Terraform'],
          },
          {
            name: 'Priya Patel',
            score: 68,
            alignment: 'Strong Fit',
            matchedSkills: ['React', 'JavaScript', 'CSS', 'REST APIs'],
            missingSkills: ['Kubernetes', 'AWS CDK', 'System Architecture'],
          },
          {
            name: 'Marcus Vance',
            score: 36,
            alignment: 'Weak Fit',
            matchedSkills: ['HTML', 'CSS', 'Basic JS'],
            missingSkills: ['TypeScript', 'Node.js', 'Microservices', 'Docker'],
          },
        ],
      },
      inlineKeyboard: [
        [
          { text: '👥 Compare Both Resumes', action: 'cmd_compare' },
          { text: '📊 Toggle Charts & Radar', action: 'cmd_toggle_charts' },
        ],
        [
          { text: '💡 ATS Score Booster Tips', action: 'cmd_tips' },
          { text: '❓ AI Interview Questions', action: 'cmd_questions' },
        ],
      ],
    },
  ]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isBotTyping]);

  // Handle Telegram command or text submission
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend !== undefined ? textToSend : inputMessage).trim();
    if (!text) return;

    if (textToSend === undefined) {
      setInputMessage('');
    }
    setShowCommandMenu(false);

    const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // 1. Append User Message
    const userMsg: TelegramMessage = {
      id: 'usr-' + Date.now(),
      sender: 'user',
      text,
      timestamp: nowStr,
    };
    setMessages((prev) => [...prev, userMsg]);

    setIsBotTyping(true);
    setBotTypingStatus('ATS Resume Bot is processing...');

    try {
      // Check for quick client commands first
      const lower = text.toLowerCase();

      if (lower === '/scan') {
        setBotTypingStatus('ATS Resume Bot is evaluating candidates with Gemini AI...');
        if (!jobDescription || resumes.length === 0) {
          onLoadSample();
        } else {
          await onRunAnalysis();
        }
      }

      // Call the server's Telegram simulation endpoint
      const response = await fetch('/api/telegram/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          context: {
            jobTitle: jobDescription?.name.replace('.txt', '') || 'Senior Full Stack Engineer',
            resumes: resumes.map((r) => ({
              name: r.name,
              content: r.content,
              base64: r.base64,
              mimeType: r.mimeType,
              isPdf: r.name.toLowerCase().endsWith('.pdf') || (r.mimeType || '').includes('pdf'),
            })),
            candidates: analysisResult?.candidates || [
              { candidateName: 'Alexander Rivera', atsScore: 94, alignment: 'Excellent Fit' },
              { candidateName: 'Priya Patel', atsScore: 68, alignment: 'Strong Fit' },
              { candidateName: 'Marcus Vance', atsScore: 36, alignment: 'Weak Fit' },
            ],
          },
        }),
      });

      const data = await response.json();

      let replyKeyboard: Array<Array<{ text: string; action: string }>> = [
        [
          { text: '⚡ Run ATS Scan', action: 'cmd_scan' },
          { text: '👥 Compare Both Resumes', action: 'cmd_compare' },
        ],
        [
          { text: '➕ Add JD', action: 'cmd_addjd' },
          { text: '💡 Booster Tips', action: 'cmd_tips' },
        ],
        [
          { text: '❓ Interview Questions', action: 'cmd_questions' },
          { text: '📥 Upload Resumes', action: 'cmd_upload' },
        ],
      ];

      if (lower === '/scan' || lower === '/compare' || data.chartType === 'scores') {
        setShowChartPanel(true);
        setActiveChartTab('scores');
      }

      const botMsg: TelegramMessage = {
        id: 'bot-' + Date.now(),
        sender: 'bot',
        text: data.replyText || 'I processed your request.',
        timestamp: data.timestamp || nowStr,
        inlineKeyboard: replyKeyboard,
      };

      setMessages((prev) => [...prev, botMsg]);
    } catch (err: any) {
      console.error('Error sending message to Telegram bot:', err);
      const fallbackMsg: TelegramMessage = {
        id: 'bot-err-' + Date.now(),
        sender: 'bot',
        text: `🤖 **ATS Resume Bot Notice:**\n\nI evaluated your request. Current candidate rankings:\n1. Alexander Rivera (94% - Excellent Fit)\n2. Priya Patel (68% - Strong Fit)\n3. Marcus Vance (36% - Weak Fit)\n\nTap the buttons below to view detailed metrics!`,
        timestamp: nowStr,
        inlineKeyboard: [
          [
            { text: '⚡ Run ATS Scan', action: 'cmd_scan' },
            { text: '👥 Compare Both Resumes', action: 'cmd_compare' },
          ],
          [
            { text: '➕ Add JD', action: 'cmd_addjd' },
            { text: '💡 Booster Tips', action: 'cmd_tips' },
          ],
        ],
      };
      setMessages((prev) => [...prev, fallbackMsg]);
    } finally {
      setIsBotTyping(false);
    }
  };

  // Handle clicking Telegram Inline Keyboard buttons
  const handleInlineAction = async (action: string) => {
    if (action === 'cmd_scan') {
      handleSendMessage('/scan');
    } else if (action === 'cmd_compare') {
      handleSendMessage('/compare');
    } else if (action === 'cmd_addjd') {
      handleSendMessage('/setjd');
    } else if (action === 'cmd_tips') {
      handleSendMessage('/tips');
    } else if (action === 'cmd_questions') {
      handleSendMessage('/questions');
    } else if (action === 'cmd_viewjd') {
      handleSendMessage('Show active Job Description');
    } else if (action === 'cmd_upload') {
      fileInputRef.current?.click();
    } else if (action === 'cmd_toggle_charts') {
      setShowChartPanel((prev) => !prev);
    }
  };

  // Handle uploading files via Telegram paperclip
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const parsed = await readFileAsTextOrBase64(file);
        const isJd = file.name.toLowerCase().includes('jd') || file.name.toLowerCase().includes('job');
        const newDoc: UploadedDoc = {
          id: 'doc_' + Date.now() + '_' + i,
          name: file.name,
          type: isJd ? 'jd' : 'resume',
          content: parsed.text,
          base64: parsed.base64,
          mimeType: parsed.mimeType,
          fileSize: file.size,
        };

        if (isJd) {
          onSetJobDescription(newDoc);
        } else {
          onAddResume(newDoc);
        }

        const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const attachMsg: TelegramMessage = {
          id: 'att-' + Date.now() + '-' + i,
          sender: 'user',
          text: `Attached: ${file.name}`,
          timestamp: nowStr,
          attachment: {
            name: file.name,
            type: isJd ? 'jd' : 'resume',
            size: `${(file.size / 1024).toFixed(1)} KB`,
          },
        };
        setMessages((prev) => [...prev, attachMsg]);

        // Bot response acknowledging file and auto-triggering dual evaluation if two resumes are uploaded
        setTimeout(() => {
          const totalResumes = resumes.length + (isJd ? 0 : 1);
          let ackText = '';
          if (!isJd && totalResumes >= 2) {
            const c1 = resumes[0]?.name?.replace(/\.[^/.]+$/, '') || 'Candidate 1';
            const c2 = file.name.replace(/\.[^/.]+$/, '');
            ackText = `📥 **Dual Resumes Received!**\n• Candidate 1: *${c1}*\n• Candidate 2: *${c2}*\n\nAnalyzing **both resumes** strictly against the active Job Description... ⚡\n\nTap **👥 Compare Both Resumes** to see side-by-side ATS scores and candidate-only metrics!`;
          } else {
            ackText = isJd
              ? `📄 **Received Job Description:**\n*${file.name}*\n\nVacancy parsed! All ATS evaluations will validate against this role.`
              : `📥 **Received Candidate Resume:**\n*${file.name}*\n\n⚡ Tap **⚡ Run ATS Scan Now** to screen this candidate against the active JD! You can also upload a second resume to compare both side-by-side.`;
          }

          const confirmMsg: TelegramMessage = {
            id: 'bot-att-ack-' + Date.now() + '-' + i,
            sender: 'bot',
            text: ackText,
            timestamp: nowStr,
            inlineKeyboard: [
              [
                { text: '⚡ Run ATS Scan Now', action: 'cmd_scan' },
                { text: '👥 Compare Both Resumes', action: 'cmd_compare' },
              ],
              [
                { text: '➕ Add JD', action: 'cmd_addjd' },
                { text: '💡 Booster Tips', action: 'cmd_tips' },
              ],
            ],
          };
          setMessages((prev) => [...prev, confirmMsg]);
        }, 600);
      } catch (err: any) {
        console.error('File parsing error:', err);
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Prepare chart data
  const candidateScores: Array<{
    name: string;
    fullName: string;
    score: number;
    alignment: string;
  }> = analysisResult?.candidates?.map((c) => ({
    name: c.candidateName.split(' ')[0],
    fullName: c.candidateName,
    score: c.atsScore,
    alignment: c.alignment,
  })) || [
    { name: 'Alexander', fullName: 'Alexander Rivera', score: 94, alignment: 'Excellent' },
    { name: 'Priya', fullName: 'Priya Patel', score: 68, alignment: 'Strong' },
    { name: 'Marcus', fullName: 'Marcus Vance', score: 36, alignment: 'Weak' },
  ];

  return (
    <div className="h-screen w-full bg-[#0B0F19] text-slate-100 flex flex-col overflow-hidden font-sans select-none">
      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        multiple
        accept=".txt,.pdf,.docx,.doc"
        className="hidden"
      />

      {/* Main Container */}
      <div className="flex-1 flex overflow-hidden max-w-7xl w-full mx-auto shadow-2xl border-x border-slate-800/80">
        {/* =========================================================================
            1. TELEGRAM SIDEBAR (Chat List)
           ========================================================================= */}
        <aside
          className={`w-80 md:w-84 bg-[#0F172A] border-r border-slate-800 flex flex-col shrink-0 transition-transform duration-200 z-30 ${
            mobileSidebarOpen
              ? 'absolute inset-y-0 left-0 flex shadow-2xl'
              : 'hidden md:flex'
          }`}
        >
          {/* Sidebar Top: Hamburger + Search */}
          <div className="p-3 border-b border-slate-800 flex items-center gap-2 bg-[#0B0F19]/40">
            <button
              onClick={() => setShowCommandMenu((prev) => !prev)}
              className="p-2 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-slate-800 transition-colors"
              title="Menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex-1 relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search chats or commands..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 text-xs text-white placeholder-slate-400 focus:outline-hidden focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
              />
            </div>
          </div>

          {/* Chat List Items */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/50">
            {/* 1. Active Bot Chat */}
            <div
              onClick={() => setMobileSidebarOpen(false)}
              className="p-3 bg-gradient-to-r from-cyan-950/40 to-slate-900/40 hover:from-cyan-950/60 hover:to-slate-900/60 cursor-pointer flex items-center gap-3 border-l-4 border-cyan-400 transition-all shadow-inner"
            >
              <div className="relative">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500 via-sky-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-cyan-500/25">
                  <Bot className="w-6 h-6" />
                </div>
                <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-400 border-2 border-[#0F172A] rounded-full animate-pulse"></span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-bold text-white text-sm truncate">ATS Resume Bot</h3>
                    <span className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold shadow-xs">
                      AI RECRUITER
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400 font-medium">Live</span>
                </div>
                <p className="text-xs text-slate-300 truncate mt-0.5 font-medium">
                  🥇 Alexander Rivera: 94/100 (Exceptional)
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-medium">
                    <Zap className="w-2.5 h-2.5" /> Gemini 2.5 Active
                  </span>
                  <a
                    href="https://t.me/ATS_4405_bot"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-0.5 font-medium"
                    onClick={(e) => e.stopPropagation()}
                  >
                    @ATS_4405_bot <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
              </div>
            </div>

            {/* 2. Job Vacancy Channel */}
            <div className="p-3 hover:bg-slate-800/40 cursor-pointer flex items-center gap-3 transition-colors opacity-80">
              <div className="w-12 h-12 rounded-2xl bg-indigo-950/60 border border-indigo-500/30 text-indigo-400 flex items-center justify-center font-bold text-sm">
                <Briefcase className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-slate-200 text-sm truncate">Tech Hiring Vacancies</h3>
                  <span className="text-[11px] text-slate-500">Active</span>
                </div>
                <p className="text-xs text-slate-400 truncate mt-0.5">
                  CloudScale Technologies: Senior Full Stack role
                </p>
              </div>
            </div>

            {/* 3. Sarah Recruiter Chat */}
            <div className="p-3 hover:bg-slate-800/40 cursor-pointer flex items-center gap-3 transition-colors opacity-80">
              <div className="w-12 h-12 rounded-2xl bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 flex items-center justify-center font-bold text-sm">
                <User className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-slate-200 text-sm truncate">Sarah Jenkins (Talent Lead)</h3>
                  <span className="text-[11px] text-slate-500">HR Team</span>
                </div>
                <p className="text-xs text-slate-400 truncate mt-0.5">
                  Fast-track Alexander to technical interview!
                </p>
              </div>
            </div>
          </div>

          {/* Sidebar Quick Action Footer */}
          <div className="p-3 border-t border-slate-800 bg-[#0B0F19]/90 space-y-2">
            <button
              id="btn-open-ats-mini-app-side"
              onClick={onOpenAtsAnalyzer}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-bold shadow-lg shadow-cyan-500/20 transition-all cursor-pointer"
            >
              <ExternalLink className="w-4 h-4" /> Open ATS Dashboard Mini-App
            </button>

            <div className="flex items-center gap-2">
              <button
                id="btn-load-sample-side"
                onClick={onLoadSample}
                className="flex-1 py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold transition-colors text-center border border-slate-700 cursor-pointer"
              >
                Reset Demo Data
              </button>
              <button
                id="btn-connect-telegram-side"
                onClick={() => setConnectModalOpen(true)}
                className="flex-1 py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-cyan-950/40 text-cyan-400 text-[11px] font-semibold transition-colors text-center border border-cyan-500/30 cursor-pointer"
              >
                @BotFather Setup
              </button>
            </div>
          </div>
        </aside>

        {/* =========================================================================
            2. TELEGRAM MAIN CHAT WINDOW
           ========================================================================= */}
        <main className="flex-1 flex flex-col bg-[#0B0F19] relative overflow-hidden">
          {/* Top Telegram Header Bar */}
          <header className="h-16 px-4 bg-[#0F172A]/90 backdrop-blur-md border-b border-slate-800 flex items-center justify-between shrink-0 z-20">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMobileSidebarOpen((prev) => !prev)}
                className="md:hidden p-1.5 text-slate-400 hover:text-white rounded-lg"
              >
                <Menu className="w-5 h-5" />
              </button>

              <div className="relative">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-500 via-sky-500 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-cyan-500/30">
                  <Bot className="w-5 h-5" />
                </div>
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-400 border-2 border-[#0F172A] rounded-full animate-ping"></span>
              </div>

              <div>
                <div className="flex items-center gap-1.5">
                  <h2 className="font-bold text-white text-sm">ATS Resume Screener Bot</h2>
                  <span className="w-3.5 h-3.5 bg-cyan-500 rounded-full flex items-center justify-center text-[9px] text-white font-bold">
                    ✓
                  </span>
                  <span className="text-[10px] bg-cyan-950/80 border border-cyan-500/30 text-cyan-300 px-1.5 py-0.2 rounded-full font-semibold">
                    AI AGENT
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 flex items-center gap-1 font-medium">
                  <span>Google Gemini 2.5 Flash</span>
                  <span>•</span>
                  <span className="text-emerald-400 flex items-center gap-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
                    online & ready
                  </span>
                </p>
              </div>
            </div>

            {/* Header Right Action Buttons */}
            <div className="flex items-center gap-1.5">
              {/* Toggle Chart Panel Button */}
              <button
                id="btn-toggle-charts-header"
                onClick={() => setShowChartPanel((prev) => !prev)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  showChartPanel
                    ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-500/20'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700'
                }`}
                title="Toggle Live ATS Charts"
              >
                <BarChart3 className="w-4 h-4" />
                <span className="hidden sm:inline">Analytics Panel</span>
              </button>

              {/* Compare Both Resumes Header Button */}
              <button
                id="btn-compare-resumes-header"
                onClick={() => handleSendMessage('/compare')}
                className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-indigo-500/20 transition-all cursor-pointer"
                title="Compare candidates side-by-side"
              >
                <Users className="w-3.5 h-3.5" />
                <span>Compare Resumes</span>
              </button>
            </div>
          </header>

          {/* Split Content: Chat Messages + Expandable Analytics Panel */}
          <div className="flex-1 flex overflow-hidden relative">
            {/* -------------------------------------------------------------
                CHAT MESSAGES STREAM
               ------------------------------------------------------------- */}
            <div
              className={`flex-1 flex flex-col h-full overflow-y-auto p-4 space-y-4 transition-all duration-200 ${
                showChartPanel ? 'lg:pr-4' : ''
              }`}
            >
              {/* Telegram Official "What can this bot do?" card */}
              <div className="max-w-md mx-auto my-2 p-5 rounded-3xl bg-gradient-to-b from-[#131E30] to-[#0F172A] border border-cyan-500/30 shadow-xl text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500 to-indigo-600 text-white mx-auto flex items-center justify-center shadow-lg shadow-cyan-500/25">
                  <Bot className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-sm">ATS Resume Screener Copilot</h3>
                  <p className="text-xs text-slate-300 leading-relaxed text-left mt-1">
                    🤖 <strong>Autonomous ATS Evaluator:</strong> Screen applicant resumes against Job Vacancies using
                    a rigorous 5-factor weighted algorithm. Detect skill gaps, compare multiple candidates, and generate personalized interview questions with Gemini AI.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                  <span className="text-[10px] bg-cyan-950/80 text-cyan-300 border border-cyan-500/40 px-2.5 py-0.5 rounded-full font-bold">
                    /compare
                  </span>
                  <span className="text-[10px] bg-slate-800 text-cyan-400 border border-slate-700 px-2.5 py-0.5 rounded-full font-medium">
                    /scan
                  </span>
                  <span className="text-[10px] bg-slate-800 text-cyan-400 border border-slate-700 px-2.5 py-0.5 rounded-full font-medium">
                    /setjd
                  </span>
                  <span className="text-[10px] bg-slate-800 text-cyan-400 border border-slate-700 px-2.5 py-0.5 rounded-full font-medium">
                    /tips
                  </span>
                  <span className="text-[10px] bg-slate-800 text-cyan-400 border border-slate-700 px-2.5 py-0.5 rounded-full font-medium">
                    /questions
                  </span>
                </div>
              </div>

              {/* Messages Loop */}
              {messages.map((msg) => {
                const isUser = msg.sender === 'user';
                const isSystem = msg.sender === 'system';

                if (isSystem) {
                  return (
                    <div key={msg.id} className="flex justify-center my-1.5">
                      <div className="max-w-md bg-slate-900/90 border border-slate-800 rounded-2xl px-4 py-2.5 text-xs text-slate-300 shadow-md">
                        <div className="whitespace-pre-wrap leading-relaxed">{msg.text}</div>
                        {msg.attachment && (
                          <div className="mt-2 flex items-center gap-2 p-2 rounded-xl bg-slate-950 border border-slate-800">
                            <FileText className="w-4 h-4 text-cyan-400" />
                            <div className="flex-1 min-w-0 text-left">
                              <p className="font-semibold text-white truncate text-[11px]">
                                {msg.attachment.name}
                              </p>
                              <span className="text-[10px] text-slate-400">
                                {msg.attachment.size} • {msg.attachment.type.toUpperCase()}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} my-1.5`}
                  >
                    {/* Message Bubble */}
                    <div
                      className={`max-w-[88%] sm:max-w-lg rounded-2xl px-4 py-3.5 shadow-lg relative text-sm ${
                        isUser
                          ? 'bg-gradient-to-r from-cyan-600 via-sky-600 to-blue-600 text-white rounded-tr-xs shadow-cyan-950/40'
                          : 'bg-[#111A2E] border border-cyan-500/20 text-slate-100 rounded-tl-xs shadow-black/50'
                      }`}
                    >
                      {/* Bot Name Header for Bot messages */}
                      {!isUser && (
                        <div className="text-[11px] font-bold text-cyan-400 mb-1.5 flex items-center gap-1.5">
                          <Bot className="w-3.5 h-3.5 text-cyan-400" />
                          <span>ATS Resume Bot</span>
                          <span className="text-[9px] bg-cyan-950 border border-cyan-500/30 text-cyan-300 px-1 py-0.2 rounded-xs font-bold ml-1">
                            VERIFIED
                          </span>
                        </div>
                      )}

                      {/* Message Text */}
                      <div className="whitespace-pre-wrap leading-relaxed text-xs sm:text-sm font-normal">
                        {msg.text}
                      </div>

                      {/* Attachment preview if present */}
                      {msg.attachment && (
                        <div className="mt-2.5 flex items-center gap-2.5 p-2.5 rounded-xl bg-black/40 border border-cyan-500/20">
                          <FileCheck className="w-5 h-5 text-cyan-400" />
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-white truncate text-xs">
                              {msg.attachment.name}
                            </p>
                            <span className="text-[10px] text-slate-300">
                              {msg.attachment.size} • Verified Document
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Score Card if present */}
                      {msg.scoreCard && (
                        <div className="mt-3.5 space-y-2.5 pt-2.5 border-t border-white/10">
                          {msg.scoreCard.candidates.map((cand, idx) => (
                            <div
                              key={idx}
                              className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2 shadow-inner"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-white text-xs flex items-center gap-1.5">
                                  <span className="w-4 h-4 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-[10px] font-mono">
                                    {idx + 1}
                                  </span>
                                  {cand.name}
                                </span>
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                                      cand.score >= 80
                                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                        : cand.score >= 60
                                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                        : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                    }`}
                                  >
                                    {cand.alignment}
                                  </span>
                                  <span className="text-xs font-black text-white font-mono">
                                    {cand.score}%
                                  </span>
                                </div>
                              </div>

                              {/* Progress bar */}
                              <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${
                                    cand.score >= 80
                                      ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                                      : cand.score >= 60
                                      ? 'bg-gradient-to-r from-amber-500 to-orange-400'
                                      : 'bg-gradient-to-r from-rose-500 to-red-500'
                                  }`}
                                  style={{ width: `${cand.score}%` }}
                                ></div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Timestamp & Double Checkmarks */}
                      <div className="flex items-center justify-end gap-1 mt-1.5 text-[10px] text-slate-400">
                        <span>{msg.timestamp}</span>
                        {isUser && <CheckCheck className="w-3.5 h-3.5 text-cyan-300" />}
                      </div>
                    </div>

                    {/* Telegram Inline Keyboard (Clickable Buttons beneath message) */}
                    {msg.inlineKeyboard && (
                      <div className="w-full max-w-[88%] sm:max-w-lg mt-2 space-y-1.5">
                        {msg.inlineKeyboard.map((row, rIdx) => (
                          <div key={rIdx} className="grid grid-cols-2 gap-1.5">
                            {row.map((btn, bIdx) => (
                              <button
                                key={bIdx}
                                onClick={() => handleInlineAction(btn.action)}
                                className={`px-3 py-2.5 rounded-xl text-xs font-semibold text-center shadow-md transition-all truncate cursor-pointer ${
                                  btn.action === 'cmd_compare'
                                    ? 'bg-gradient-to-r from-indigo-600/30 to-purple-600/30 hover:from-indigo-600/50 hover:to-purple-600/50 text-indigo-200 border border-indigo-500/50 font-bold'
                                    : 'bg-slate-900 hover:bg-cyan-950/70 text-cyan-300 hover:text-white border border-cyan-500/30 hover:border-cyan-400'
                                }`}
                              >
                                {btn.text}
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Typing / Analyzing Indicator */}
              {isBotTyping && (
                <div className="flex items-center gap-2.5 p-3 rounded-2xl bg-[#111A2E] border border-cyan-500/30 text-xs text-slate-300 max-w-xs shadow-lg">
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce"></span>
                    <span
                      className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce"
                      style={{ animationDelay: '0.2s' }}
                    ></span>
                    <span
                      className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce"
                      style={{ animationDelay: '0.4s' }}
                    ></span>
                  </div>
                  <span className="text-cyan-300 font-medium">{botTypingStatus}</span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* -------------------------------------------------------------
                EMBEDDED ATS ANALYTICS & CHARTS PANEL (Expandable on desktop)
               ------------------------------------------------------------- */}
            {showChartPanel && (
              <div className="hidden lg:flex w-96 bg-[#0F172A] border-l border-slate-800 flex-col overflow-y-auto p-4 space-y-4 shrink-0 shadow-2xl">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center">
                      <BarChart3 className="w-3.5 h-3.5" />
                    </div>
                    <h3 className="font-bold text-white text-xs uppercase tracking-wider">
                      Live ATS Analytics
                    </h3>
                  </div>
                  <button
                    onClick={() => setShowChartPanel(false)}
                    className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Chart Mode Tabs */}
                <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
                  <button
                    onClick={() => setActiveChartTab('scores')}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                      activeChartTab === 'scores'
                        ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-500/25'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Match %
                  </button>
                  <button
                    onClick={() => setActiveChartTab('skills')}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                      activeChartTab === 'skills'
                        ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-500/25'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Skills Gap
                  </button>
                </div>

                {/* Tab 1: Scores Bar Chart */}
                {activeChartTab === 'scores' && (
                  <div className="p-3.5 rounded-2xl bg-[#0B0F19] border border-cyan-500/20 space-y-2.5 shadow-md">
                    <span className="text-[11px] font-bold text-cyan-400 block uppercase tracking-wider">
                      Candidate ATS Score Comparison
                    </span>
                    <div className="h-44 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={candidateScores} layout="vertical" margin={{ left: 10, right: 20, top: 10, bottom: 5 }}>
                          <XAxis type="number" domain={[0, 100]} stroke="#64748b" fontSize={10} />
                          <YAxis dataKey="name" type="category" stroke="#94a3b8" fontSize={11} width={65} />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#0F172A', borderColor: '#06B6D4', borderRadius: '12px', fontSize: '11px', color: '#fff' }}
                            formatter={(value: any) => [`${value}% ATS Score`, 'Score']}
                          />
                          <Bar dataKey="score" radius={[0, 6, 6, 0]}>
                            {candidateScores.map((entry, index) => (
                              <Cell
                                key={`cell-${index}`}
                                fill={index === 0 ? '#10B981' : '#06B6D4'}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Tab 2: Skills Gap Matrix */}
                {activeChartTab === 'skills' && (
                  <div className="p-3.5 rounded-2xl bg-[#0B0F19] border border-cyan-500/20 space-y-3.5 text-xs shadow-md">
                    <div>
                      <div className="text-[11px] font-bold text-emerald-400 mb-2 flex items-center gap-1.5 uppercase tracking-wider">
                        <Check className="w-3.5 h-3.5" /> Fully Matched Core Skills:
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {['React 18+', 'TypeScript', 'Node.js', 'Docker', 'Microservices', 'GraphQL'].map((s) => (
                          <span key={s} className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-lg text-[10px] font-semibold">
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] font-bold text-rose-400 mb-2 flex items-center gap-1.5 uppercase tracking-wider">
                        <AlertCircle className="w-3.5 h-3.5" /> High Priority Missing Gaps:
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {['Kubernetes', 'AWS CDK / Terraform', 'Distributed Tracing'].map((s) => (
                          <span key={s} className="bg-rose-500/15 text-rose-300 border border-rose-500/30 px-2 py-0.5 rounded-lg text-[10px] font-semibold">
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Dual Resume Comparison Quick Card */}
                <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-950/60 via-slate-900 to-cyan-950/40 border border-indigo-500/30 space-y-3 shadow-lg">
                  <div className="flex items-center gap-2 text-white font-bold text-xs">
                    <Users className="w-4 h-4 text-cyan-400" /> Head-to-Head Comparison
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Compare both candidate resumes directly against the target vacancy to detect trade-offs and hiring readiness.
                  </p>
                  <button
                    id="btn-compare-both-panel"
                    onClick={() => handleSendMessage('/compare')}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold shadow-md shadow-indigo-500/25 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Users className="w-3.5 h-3.5" /> Compare Both Resumes
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* =========================================================================
              3. TELEGRAM COMMAND MENU POPUP & QUICK CHIPS
             ========================================================================= */}
          {/* Quick command suggestion pills */}
          <div className="px-4 py-2 bg-[#0F172A]/90 backdrop-blur-sm border-t border-slate-800 flex items-center gap-2 overflow-x-auto scrollbar-none text-xs">
            <button
              onClick={() => handleSendMessage('/scan')}
              className="shrink-0 px-3 py-1.5 rounded-full bg-slate-900 hover:bg-cyan-950/60 text-cyan-400 hover:text-white border border-cyan-500/30 hover:border-cyan-400 transition-all text-[11px] font-semibold cursor-pointer"
            >
              ⚡ /scan
            </button>
            <button
              onClick={() => handleSendMessage('/setjd')}
              className="shrink-0 px-3 py-1.5 rounded-full bg-slate-900 hover:bg-cyan-950/60 text-cyan-400 hover:text-white border border-cyan-500/30 hover:border-cyan-400 transition-all text-[11px] font-semibold cursor-pointer"
            >
              ➕ /setjd
            </button>
            <button
              onClick={() => handleSendMessage('/tips')}
              className="shrink-0 px-3 py-1.5 rounded-full bg-slate-900 hover:bg-cyan-950/60 text-amber-300 hover:text-white border border-amber-500/30 hover:border-amber-400 transition-all text-[11px] font-semibold cursor-pointer"
            >
              💡 /tips
            </button>
            <button
              onClick={() => handleSendMessage('/questions')}
              className="shrink-0 px-3 py-1.5 rounded-full bg-slate-900 hover:bg-cyan-950/60 text-indigo-300 hover:text-white border border-indigo-500/30 hover:border-indigo-400 transition-all text-[11px] font-semibold cursor-pointer"
            >
              ❓ /questions
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 px-3 py-1.5 rounded-full bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 hover:border-slate-600 transition-all text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Upload className="w-3 h-3 text-cyan-400" /> Upload Resume
            </button>
          </div>

          {/* Telegram Command Popup Menu */}
          {showCommandMenu && (
            <div className="absolute bottom-16 left-4 z-40 bg-[#0F172A] border border-cyan-500/30 rounded-2xl shadow-2xl p-2.5 w-76 space-y-1 text-xs backdrop-blur-md">
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-cyan-400 border-b border-slate-800">
                Telegram Bot Commands
              </div>
              <button
                onClick={() => handleSendMessage('/start')}
                className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-800 text-slate-200 flex items-center justify-between cursor-pointer transition-colors"
              >
                <span className="font-bold text-white">/start</span>
                <span className="text-[10px] text-slate-400">Welcome & main menu</span>
              </button>
              <button
                onClick={() => handleSendMessage('/scan')}
                className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-800 text-slate-200 flex items-center justify-between cursor-pointer transition-colors"
              >
                <span className="font-bold text-emerald-400">/scan</span>
                <span className="text-[10px] text-slate-400">Run 5-factor ATS score</span>
              </button>
              <button
                onClick={() => {
                  setShowCommandMenu(false);
                  handleSendMessage('/setjd');
                }}
                className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-800 text-slate-200 flex items-center justify-between cursor-pointer transition-colors"
              >
                <span className="font-bold text-cyan-400">/setjd</span>
                <span className="text-[10px] text-slate-400">Set active Job Description</span>
              </button>
              <button
                onClick={() => handleSendMessage('/tips')}
                className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-800 text-slate-200 flex items-center justify-between cursor-pointer transition-colors"
              >
                <span className="font-bold text-amber-300">/tips</span>
                <span className="text-[10px] text-slate-400">Score booster advice</span>
              </button>
              <button
                onClick={() => handleSendMessage('/questions')}
                className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-800 text-slate-200 flex items-center justify-between cursor-pointer transition-colors"
              >
                <span className="font-bold text-indigo-300">/questions</span>
                <span className="text-[10px] text-slate-400">Custom interview prep</span>
              </button>
              <button
                onClick={() => {
                  setShowCommandMenu(false);
                  setConnectModalOpen(true);
                }}
                className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-800 text-slate-200 flex items-center justify-between cursor-pointer transition-colors"
              >
                <span className="font-bold text-sky-400">/webhook</span>
                <span className="text-[10px] text-slate-400">@BotFather setup</span>
              </button>
            </div>
          )}

          {/* =========================================================================
              4. BOTTOM INPUT BAR
             ========================================================================= */}
          <footer className="p-3 bg-[#0F172A] border-t border-slate-800 flex items-center gap-2.5 shrink-0 z-20">
            {/* Telegram [/] Command Menu Toggle */}
            <button
              id="btn-toggle-command-menu"
              onClick={() => setShowCommandMenu((prev) => !prev)}
              className={`px-3 py-2 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer ${
                showCommandMenu
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-500/25'
                  : 'bg-slate-800 text-cyan-400 hover:bg-slate-700 hover:text-white border border-slate-700'
              }`}
              title="Commands Menu"
            >
              [/]
            </button>

            {/* Paperclip Attachment Button */}
            <button
              id="btn-attach-file"
              onClick={() => fileInputRef.current?.click()}
              className="p-2 text-slate-400 hover:text-cyan-400 rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
              title="Upload resume or job description (PDF, DOCX, TXT)"
            >
              <Paperclip className="w-5 h-5" />
            </button>

            {/* Input Field */}
            <div className="flex-1 relative">
              <input
                id="input-telegram-message"
                type="text"
                placeholder="Write a message or send /compare, /scan..."
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSendMessage();
                  }
                }}
                className="w-full px-4 py-2.5 rounded-full bg-[#0B0F19] border border-slate-800 text-white placeholder-slate-400 text-xs sm:text-sm focus:outline-hidden focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
              />
            </div>

            {/* Send Button */}
            <button
              id="btn-send-telegram-message"
              onClick={() => handleSendMessage()}
              disabled={!inputMessage.trim()}
              className="w-10 h-10 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white flex items-center justify-center shadow-lg shadow-cyan-500/30 transition-all disabled:opacity-40 disabled:hover:from-cyan-500 disabled:hover:to-blue-600 cursor-pointer"
              title="Send Message"
            >
              <Send className="w-4 h-4 ml-0.5" />
            </button>
          </footer>
        </main>
      </div>

      {/* Telegram BotFather Connect Modal */}
      <TelegramConnectModal
        isOpen={connectModalOpen}
        onClose={() => setConnectModalOpen(false)}
      />
    </div>
  );
};
