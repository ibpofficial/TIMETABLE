import { useState, useRef, useEffect } from 'react';
import {
  Sparkles, Send, Minimize2, Loader2,
  Zap, Users, Building, AlertTriangle, Bot, X,
  Copy, RotateCcw, MessageSquare, GraduationCap
} from 'lucide-react';
import { toast } from 'sonner';
import { useTimetableStore } from '../store/useTimetableStore';
import { fetchAiTip, fetchAiAgent } from '../api/client';

// ── Types ────────────────────────────────────────────────────────────────────
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
  timestamp?: Date;
}

// ── Inline markdown renderer ─────────────────────────────────────────────────
function RenderMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1.5 text-xs leading-relaxed">
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1" />;
        if (/^###\s/.test(line)) return (
          <p key={i} className="text-[10px] font-bold uppercase tracking-widest text-brand-light/90 border-b border-brand/20 pb-0.5 mt-2">{line.replace(/^###\s/, '')}</p>
        );
        if (/^##\s/.test(line)) return (
          <p key={i} className="text-xs font-black text-brand-light mt-2">{line.replace(/^##\s/, '')}</p>
        );
        if (/^#\s/.test(line)) return (
          <p key={i} className="font-black text-slate-100 text-xs mt-2">{line.replace(/^#\s/, '')}</p>
        );
        const isBullet = /^[\*\-\•]\s/.test(line.trimStart());
        const isNumbered = /^\d+\.\s/.test(line.trimStart());
        const renderInline = (str: string) => {
          const parts = str.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
          return parts.map((p, j) => {
            if (/^\*\*/.test(p)) return <strong key={j} className="font-bold text-slate-100">{p.slice(2, -2)}</strong>;
            if (/^`/.test(p)) return <code key={j} className="bg-white/10 dark:bg-white/10 px-1 py-0.5 rounded text-[10px] font-mono text-cyan-300">{p.slice(1, -1)}</code>;
            return <span key={j}>{p.replace(/->/g, ' ➔ ')}</span>;
          });
        };
        if (isBullet) return (
          <div key={i} className="flex gap-2 items-start">
            <span className="text-brand-light mt-0.5 shrink-0">▸</span>
            <span className="text-slate-300 dark:text-slate-300">{renderInline(line.replace(/^[\s]*[\*\-\•]\s/, ''))}</span>
          </div>
        );
        if (isNumbered) return (
          <div key={i} className="flex gap-2 items-start">
            <span className="text-brand-light font-bold text-[10px] shrink-0 mt-0.5">{line.match(/^\d+/)?.[0]}.</span>
            <span className="text-slate-300 dark:text-slate-300">{renderInline(line.replace(/^\d+\.\s/, ''))}</span>
          </div>
        );
        return <p key={i} className="text-slate-300 dark:text-slate-300">{renderInline(line)}</p>;
      })}
    </div>
  );
}

// ── Quick action buttons ─────────────────────────────────────────────────────
const QUICK_ACTIONS = [
  { label: 'Check Conflicts', icon: <AlertTriangle size={11} />, msg: 'Run a full conflict report on the current timetable.' },
  { label: 'Faculty Loads', icon: <Users size={11} />, msg: 'Show me the workload and busyness ratios for all faculty members.' },
  { label: 'Room Utilization', icon: <Building size={11} />, msg: 'Check utilization rates for all rooms — which are over/under-used?' },
  { label: 'Top Fixes', icon: <Zap size={11} />, msg: 'Based on current constraints, what are the top 3 improvements I can make before generating?' },
];

export function AiPanel() {
  const store = useTimetableStore();
  const { currentStep } = store;

  // DEFAULT MINIMIZED — does not push down or scroll page
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [activeTab, setActiveTab] = useState<'chat' | 'coach'>('chat');

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([{
    role: 'assistant',
    content: '### 👋 AI Scheduling Copilot\n\nI have real-time access to your live **curriculum, rooms, and constraints**.\n* Inspect faculty loads & room heatmaps\n* Explain why sessions failed to schedule\n* Suggest smallest-edit conflict fixes\n\nAsk me anything or tap a shortcut below!',
    timestamp: new Date(),
  }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionCalls, setSessionCalls] = useState(0);
  const MAX_CALLS = 60;

  const abortControllerRef = useRef<AbortController | null>(null);
  const coachAbortControllerRef = useRef<AbortController | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamIntervalRef = useRef<any>(null);

  // Thinking phrases
  const [thinkingText, setThinkingText] = useState('Analyzing configurations...');
  const thinkingTexts = [
    'Scanning classroom capacities...',
    'Checking faculty profiles...',
    'Analyzing slot matrices...',
    'Running conflict metrics...',
    'Drafting suggestions...'
  ];

  // Coach state
  const [tip, setTip] = useState('');
  const [tipLoading, setTipLoading] = useState(false);
  const [tipLoaded, setTipLoaded] = useState(false);

  useEffect(() => { setTipLoaded(false); setTip(''); }, [currentStep]);

  // INTERNAL ONLY scroll: never scroll the window, only the chat container when visible
  useEffect(() => {
    if (!isCollapsed && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, loading, isCollapsed]);

  // Global Ctrl+I shortcut to toggle
  useEffect(() => {
    const handleKeys = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isTyping = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.getAttribute('contenteditable') === 'true'
      );
      if (isTyping) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setIsCollapsed(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeys);
    return () => {
      window.removeEventListener('keydown', handleKeys);
      if (abortControllerRef.current) abortControllerRef.current.abort();
      if (coachAbortControllerRef.current) coachAbortControllerRef.current.abort();
    };
  }, []);

  // Thinking loop
  useEffect(() => {
    if (!loading) return;
    setThinkingText('Analyzing schedule parameters...');
    let idx = 0;
    const interval = setInterval(() => {
      idx = (idx + 1) % thinkingTexts.length;
      setThinkingText(thinkingTexts[idx]);
    }, 2000);
    return () => clearInterval(interval);
  }, [loading]);

  const buildStoreSnapshot = () => ({
    currentStep,
    days: store.days,
    startTime: store.startTime,
    endTime: store.endTime,
    slotLength: store.slotLength,
    maxClassesPerDay: store.maxClassesPerDay,
    theoryRooms: store.theoryRooms,
    labRooms: store.labRooms,
    batches: store.batches,
    batchSizes: store.batchSizes,
    faculties: store.faculties,
    subjects: store.subjects,
    departments: store.departments,
    programs: store.programs,
    diagnostics: store.diagnostics,
    solution: store.solution,
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Response copied to clipboard!');
  };

  const handleRegenerate = () => {
    if (messages.length < 2 || loading) return;
    let lastUserMessageIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserMessageIdx = i;
        break;
      }
    }
    if (lastUserMessageIdx === -1) return;
    const userMsg = messages[lastUserMessageIdx];
    setMessages(prev => prev.slice(0, lastUserMessageIdx));
    sendMessage(userMsg.content);
  };

  const streamMessage = (fullText: string, toolsUsed?: string[]) => {
    setLoading(false);
    if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
    const timestamp = new Date();
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: '',
      toolsUsed,
      timestamp,
    }]);

    let currentLength = 0;
    const speed = 15;
    streamIntervalRef.current = setInterval(() => {
      currentLength += speed;
      if (currentLength >= fullText.length) {
        if (streamIntervalRef.current) {
          clearInterval(streamIntervalRef.current);
          streamIntervalRef.current = null;
        }
        setMessages(prev => prev.map(m => m.timestamp === timestamp ? { ...m, content: fullText } : m));
      } else {
        setMessages(prev => prev.map(m => m.timestamp === timestamp ? { ...m, content: fullText.substring(0, currentLength) + '▍' } : m));
      }
    }, 20);
  };

  const sendMessage = async (text: string) => {
    const userText = text.trim();
    if (!userText || loading) return;
    if (sessionCalls >= MAX_CALLS) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '⚠️ **Session limit reached** (60 queries used). Reload page to start fresh.',
        timestamp: new Date(),
      }]);
      return;
    }

    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
    if (abortControllerRef.current) abortControllerRef.current.abort();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const userMsg: ChatMessage = { role: 'user', content: userText, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    setSessionCalls(c => c + 1);

    try {
      const history = [...messages.slice(-8), userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }));
      const { reply, toolsUsed } = await fetchAiAgent(history, buildStoreSnapshot(), controller.signal);
      streamMessage(reply, toolsUsed);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: '⏹️ *Response stopped.*',
          timestamp: new Date(),
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `❌ **Error**: ${err.message || 'AI agent request failed.'}`,
          timestamp: new Date(),
        }]);
      }
      setLoading(false);
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
    }
  };

  const loadCoachTip = async () => {
    if (tipLoading) return;
    setTipLoading(true);
    if (coachAbortControllerRef.current) coachAbortControllerRef.current.abort();
    const controller = new AbortController();
    coachAbortControllerRef.current = controller;

    try {
      const context = {
        days: store.days, startTime: store.startTime, endTime: store.endTime,
        slotLength: store.slotLength, maxClassesPerDay: store.maxClassesPerDay,
        theoryRoomsCount: store.theoryRooms.length, labRoomsCount: store.labRooms.length,
        batchesCount: store.batches.length, facultiesCount: store.faculties.length,
        subjectsCount: store.subjects.length, departmentsCount: store.departments.length,
      };
      const res = await fetchAiTip(`step_${currentStep}`, {}, context, controller.signal);
      setTip(res.reply);
      setTipLoaded(true);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setTip(`⚠️ Could not load tip: ${err.message}`);
        setTipLoaded(true);
      }
    } finally {
      setTipLoading(false);
      if (coachAbortControllerRef.current === controller) coachAbortControllerRef.current = null;
    }
  };

  // ── MINIMIZED CIRCULAR FLOATING LAUNCHER ──────────────────────────────────
  if (isCollapsed) {
    return (
      <aside aria-label="AI Assistant" className="fixed bottom-6 right-6 z-50 no-print flex items-center gap-3 group">
        {/* Floating Tooltip Hint on hover */}
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/90 dark:bg-slate-950/90 border border-white/10 text-white shadow-2xl backdrop-blur-md opacity-0 translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 pointer-events-none">
          <span className="text-[11px] font-bold text-slate-200">Ask AI Copilot</span>
          <kbd className="bg-white/10 text-[9px] px-1.5 py-0.5 rounded font-mono text-slate-300">Ctrl+I</kbd>
        </div>

        {/* Circular Glowing Action Button */}
        <button
          onClick={() => setIsCollapsed(false)}
          className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center cursor-pointer transition-all duration-500 hover:scale-110 active:scale-95 focus:outline-none"
          title="Open AI Timetable Copilot (Ctrl+I)"
          aria-label="Open AI Copilot"
        >
          {/* Animated Neon Gradient Glow Aura */}
          <span className="absolute -inset-1 rounded-full bg-gradient-to-tr from-violet-600 via-fuchsia-500 to-cyan-400 opacity-75 blur-md group-hover:opacity-100 group-hover:blur-lg animate-pulse transition duration-500" />
          
          {/* Outer Gradient Border */}
          <span className="absolute inset-0 rounded-full p-[2px] bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 opacity-90 transition-transform duration-1000 group-hover:rotate-180">
            <span className="block w-full h-full rounded-full bg-slate-950 dark:bg-[#070913]" />
          </span>

          {/* Inner Circular Glass Core */}
          <div className="relative z-10 w-full h-full rounded-full flex items-center justify-center bg-gradient-to-br from-indigo-950/90 via-slate-950/95 to-purple-950/90 backdrop-blur-xl border border-white/20 shadow-inner group-hover:border-white/40 transition-colors">
            {/* Bot & Sparkles Icon */}
            <div className="relative flex items-center justify-center text-white">
              <Bot size={24} className="text-white drop-shadow-[0_0_10px_rgba(168,85,247,0.8)] group-hover:scale-110 group-hover:rotate-6 transition-all duration-300" />
              <Sparkles size={12} className="absolute -top-1.5 -right-2 text-cyan-300 animate-bounce" />
            </div>

            {/* Glowing Online Status Indicator */}
            <span className="absolute top-1.5 right-1.5 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-80" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border-2 border-slate-950" />
            </span>
          </div>
        </button>
      </aside>
    );
  }

  // ── EXPANDED FLOATING MODAL DOCK ──────────────────────────────────────────
  return (
    <aside
      aria-label="AI Assistant Panel"
      className="fixed bottom-6 right-6 z-50 no-print w-[420px] max-w-[calc(100vw-2rem)] h-[580px] max-h-[calc(100vh-5rem)] flex flex-col bg-slate-900/95 dark:bg-[#0c1024]/95 backdrop-blur-2xl border border-white/10 dark:border-white/10 rounded-2xl shadow-[0_25px_60px_-15px_rgba(0,0,0,0.6)] overflow-hidden transition-all duration-300 animate-pop-in"
    >
      {/* Decorative Gradient Top Glow */}
      <div className="h-1 w-full bg-gradient-to-r from-brand via-indigo-500 to-cyan-400 shrink-0" />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08] bg-white/[0.02] shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand to-indigo-600 flex items-center justify-center text-white shadow-md shadow-brand/20">
            <Bot size={14} />
          </div>
          <div>
            <h2 className="text-xs font-black text-slate-100 uppercase tracking-wider leading-none">AI Copilot</h2>
            <p className="text-[10px] text-slate-400 mt-0.5">Live Timetable Assistant</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Tabs */}
          <div className="flex bg-black/30 border border-white/10 rounded-lg p-0.5 mr-1">
            <button
              onClick={() => setActiveTab('chat')}
              className={`px-2.5 py-1 rounded-md text-[10px] font-bold flex items-center gap-1 transition-all ${
                activeTab === 'chat' ? 'bg-brand text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              <MessageSquare size={10} /> Chat
            </button>
            <button
              onClick={() => setActiveTab('coach')}
              className={`px-2.5 py-1 rounded-md text-[10px] font-bold flex items-center gap-1 transition-all ${
                activeTab === 'coach' ? 'bg-brand text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              <GraduationCap size={10} /> Coach
            </button>
          </div>

          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            title="Minimize (Ctrl+I)"
          >
            <Minimize2 size={13} />
          </button>
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            title="Close"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* ── Chat Tab ────────────────────────────────────────────────────────── */}
      {activeTab === 'chat' && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Messages list */}
          <div
            ref={chatScrollRef}
            className="flex-1 overflow-y-auto px-4 py-3 space-y-3.5 scrollbar-thin min-h-0"
          >
            {messages.map((msg, i) => {
              const isUser = msg.role === 'user';
              return (
                <div key={i} className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div
                    className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs shrink-0 font-bold ${
                      isUser
                        ? 'bg-brand/20 text-brand-light border border-brand/30'
                        : 'bg-gradient-to-br from-brand to-indigo-600 text-white shadow-sm'
                    }`}
                  >
                    {isUser ? 'U' : <Bot size={13} />}
                  </div>

                  <div className={`max-w-[85%] flex flex-col gap-1 relative group`}>
                    <div
                      className={`rounded-2xl px-3.5 py-2.5 text-xs ${
                        isUser
                          ? 'bg-brand text-white rounded-tr-none shadow-md'
                          : 'bg-white/[0.04] dark:bg-slate-800/60 border border-white/[0.08] rounded-tl-none text-slate-200'
                      }`}
                    >
                      <RenderMarkdown text={msg.content} />
                    </div>

                    {!isUser && (
                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
                        <button
                          onClick={() => copyToClipboard(msg.content)}
                          className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-slate-200 text-[10px] flex items-center gap-1"
                        >
                          <Copy size={10} /> Copy
                        </button>
                        {i === messages.length - 1 && !loading && (
                          <button
                            onClick={handleRegenerate}
                            className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-slate-200 text-[10px] flex items-center gap-1"
                          >
                            <RotateCcw size={10} /> Retry
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="flex gap-2.5 items-center bg-brand/10 border border-brand/20 rounded-xl px-3 py-2 text-xs text-brand-light">
                <Loader2 size={13} className="animate-spin text-brand-light" />
                <span className="text-[11px] font-mono italic">{thinkingText}</span>
              </div>
            )}
          </div>

          {/* Quick Shortcuts (when conversation is short) */}
          {messages.length <= 1 && (
            <div className="grid grid-cols-2 gap-1.5 px-3 py-2 border-t border-white/[0.06] bg-black/20 shrink-0">
              {QUICK_ACTIONS.map((qa, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(qa.msg)}
                  disabled={loading || sessionCalls >= MAX_CALLS}
                  className="p-2 rounded-xl bg-white/[0.03] hover:bg-brand/10 border border-white/[0.06] hover:border-brand/30 text-left transition-all group"
                >
                  <div className="flex items-center gap-1.5 text-slate-300 group-hover:text-brand-light font-bold text-[10px]">
                    <span className="text-brand-light">{qa.icon}</span>
                    <span>{qa.label}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Chat input */}
          <div className="p-3 border-t border-white/[0.08] bg-black/40 shrink-0">
            <div className="relative flex items-center bg-white/[0.04] border border-white/10 focus-within:border-brand rounded-xl overflow-hidden transition-all">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); sendMessage(input); } }}
                placeholder={sessionCalls >= MAX_CALLS ? 'Session limit reached' : 'Ask AI to optimize, solve clashes...'}
                disabled={loading || sessionCalls >= MAX_CALLS}
                className="w-full bg-transparent px-3 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none pr-10"
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || loading || sessionCalls >= MAX_CALLS}
                className="absolute right-1.5 p-1.5 rounded-lg bg-brand hover:bg-brand-light text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                title="Send"
              >
                {loading ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              </button>
            </div>
            <div className="flex justify-between items-center mt-1.5 px-1 text-[9px] text-slate-500">
              <span>Press Enter to send</span>
              <span>{sessionCalls}/{MAX_CALLS} queries</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Coach Tab ───────────────────────────────────────────────────────── */}
      {activeTab === 'coach' && (
        <div className="flex-1 flex flex-col p-4 overflow-y-auto space-y-3 min-h-0">
          <div className="flex items-center justify-between p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-amber-400" />
              <span className="text-xs font-bold text-amber-300">Step {currentStep} Guidelines</span>
            </div>
            <button
              onClick={loadCoachTip}
              disabled={tipLoading}
              className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-bold text-[10px] flex items-center gap-1 transition-all"
            >
              {tipLoading ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
              {tipLoaded ? 'Refresh' : 'Get Tips'}
            </button>
          </div>

          {tipLoading && (
            <div className="flex-1 flex items-center justify-center gap-2 text-slate-400 text-xs py-8">
              <Loader2 size={15} className="animate-spin text-brand" />
              <span>Analyzing step requirements…</span>
            </div>
          )}

          {tipLoaded && tip && (
            <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-xs">
              <RenderMarkdown text={tip} />
            </div>
          )}

          {!tipLoaded && !tipLoading && (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-500 text-xs">
              <Sparkles size={24} className="text-slate-600 mb-2" />
              <p>Click "Get Tips" to receive step-specific advice for Step {currentStep}.</p>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
