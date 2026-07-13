import { useState, useRef, useEffect } from 'react';
import {
  Sparkles, Send, Minimize2, Maximize2, Loader2,
  Zap, Users, Building, AlertTriangle, Bot, X,
  Copy, RotateCcw
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
    <div className="space-y-1.5 text-sm leading-relaxed">
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1" />;
        if (/^###\s/.test(line)) return (
          <p key={i} className="text-[11px] font-bold uppercase tracking-widest text-brand/80 border-b border-brand/15 pb-0.5 mt-2">{line.replace(/^###\s/, '')}</p>
        );
        if (/^##\s/.test(line)) return (
          <p key={i} className="text-xs font-extrabold text-brand-light mt-2">{line.replace(/^##\s/, '')}</p>
        );
        if (/^#\s/.test(line)) return (
          <p key={i} className="font-black text-slate-100 text-[13px] mt-2">{line.replace(/^#\s/, '')}</p>
        );
        const isBullet = /^[\*\-\•]\s/.test(line.trimStart());
        const isNumbered = /^\d+\.\s/.test(line.trimStart());
        const renderInline = (str: string) => {
          const parts = str.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
          return parts.map((p, j) => {
            if (/^\*\*/.test(p)) return <strong key={j} className="font-bold text-slate-100">{p.slice(2, -2)}</strong>;
            if (/^`/.test(p)) return <code key={j} className="bg-white/10 px-1 rounded text-[11px] font-mono text-brand-light">{p.slice(1, -1)}</code>;
            return <span key={j}>{p.replace(/->/g, ' ➔ ')}</span>;
          });
        };
        if (isBullet) return (
          <div key={i} className="flex gap-2 items-start">
            <span className="text-brand mt-0.5 shrink-0">▸</span>
            <span className="text-slate-300">{renderInline(line.replace(/^[\s]*[\*\-\•]\s/, ''))}</span>
          </div>
        );
        if (isNumbered) return (
          <div key={i} className="flex gap-2 items-start">
            <span className="text-brand/70 font-bold text-[11px] shrink-0 mt-0.5">{line.match(/^\d+/)?.[0]}.</span>
            <span className="text-slate-300">{renderInline(line.replace(/^\d+\.\s/, ''))}</span>
          </div>
        );
        return <p key={i} className="text-slate-300">{renderInline(line)}</p>;
      })}
    </div>
  );
}

// ── Quick action buttons ─────────────────────────────────────────────────────
const QUICK_ACTIONS = [
  { label: 'Check all conflicts', icon: <AlertTriangle size={11} />, msg: 'Run a full conflict report on the current timetable.' },
  { label: 'Faculty workloads', icon: <Users size={11} />, msg: 'Show me the workload and busyness ratios for all faculty members.' },
  { label: 'Room utilization', icon: <Building size={11} />, msg: 'Check utilization rates for all rooms — which are over/under-used?' },
  { label: 'Suggest improvements', icon: <Zap size={11} />, msg: 'Based on current constraints, what are the top 3 improvements I can make before generating?' },
];

// ── Main Component ───────────────────────────────────────────────────────────
export function AiPanel() {
  const store = useTimetableStore();
  const { currentStep } = store;

  const getFollowUpSuggestions = (content: string): string[] => {
    const text = content.toLowerCase();
    if (text.includes('conflict') || text.includes('failed') || text.includes('diagnostics') || text.includes('unplaced')) {
      return ['Check all conflicts', 'Suggest improvements', 'Room utilization'];
    }
    if (text.includes('faculty') || text.includes('workload') || text.includes('teacher')) {
      return ['Faculty workloads', 'Check all conflicts', 'Suggest improvements'];
    }
    if (text.includes('room') || text.includes('utilization') || text.includes('capacity')) {
      return ['Room utilization', 'Suggest improvements', 'Check all conflicts'];
    }
    return ['Suggest improvements', 'Faculty workloads', 'Room utilization'];
  };

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'coach'>('chat');

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([{
    role: 'assistant',
    content: '### 👋 Welcome to AI Scheduling Agent\n\nI can query your **live scheduling data** to help you:\n* Check faculty workloads and room utilization\n* Explain exactly why a subject failed to schedule\n* Suggest concrete fixes for conflicts\n\nUse the quick buttons below, or ask me anything about your timetable!',
    timestamp: new Date(),
  }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionCalls, setSessionCalls] = useState(0);
  const MAX_CALLS = 60;

  // Abort controllers for stopping responses
  const abortControllerRef = useRef<AbortController | null>(null);
  const coachAbortControllerRef = useRef<AbortController | null>(null);

  // Thinking phases placeholders
  const [thinkingText, setThinkingText] = useState('Analyzing campus configurations...');
  const thinkingTexts = [
    'Scanning classroom capacity constraints...',
    'Checking faculty availability profiles...',
    'Analyzing campus slot configurations...',
    'Running conflict resolution metrics...',
    'Reviewing department program guidelines...',
    'Drafting recommended adjustments...'
  ];

  // Coach state
  const [tip, setTip] = useState('');
  const [tipLoading, setTipLoading] = useState(false);
  const [tipLoaded, setTipLoaded] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamIntervalRef = useRef<any>(null);

  // Reset coach on step change
  useEffect(() => { setTipLoaded(false); setTip(''); }, [currentStep]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Clean up active queries and add Ctrl+I collapse shortcut listener
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

  // Cycle thinking phrases when loading is active
  useEffect(() => {
    if (!loading) return;
    setThinkingText('Analyzing campus configurations...');
    let idx = 0;
    const interval = setInterval(() => {
      idx = (idx + 1) % thinkingTexts.length;
      setThinkingText(thinkingTexts[idx]);
    }, 2000);
    return () => clearInterval(interval);
  }, [loading]);

  // Build store state snapshot to send to agent
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
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
    }

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
        content: '⚠️ **Session limit reached** — you have used your 60 AI queries for this session. Please reload to reset.',
        timestamp: new Date(),
      }]);
      return;
    }

    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

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
          content: '⏹️ *Response stopped by user.*',
          timestamp: new Date(),
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `❌ **Error**: ${err.message || 'Failed to reach the AI agent. Ensure the backend is running.'}`,
          timestamp: new Date(),
        }]);
      }
      setLoading(false);
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  };

  const loadCoachTip = async () => {
    if (tipLoading) return;
    setTipLoading(true);

    if (coachAbortControllerRef.current) {
      coachAbortControllerRef.current.abort();
    }
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
      if (err.name === 'AbortError') {
        // Ignored
      } else {
        setTip(`⚠️ Could not load tip: ${err.message}`);
        setTipLoaded(true);
      }
    } finally {
      setTipLoading(false);
      if (coachAbortControllerRef.current === controller) {
        coachAbortControllerRef.current = null;
      }
    }
  };

  // ── Collapsed state ──────────────────────────────────────────────────────
  if (isCollapsed) {
    return (
      <div className="no-print mt-8 cursor-pointer animate-fade-in" onClick={() => setIsCollapsed(false)}>
        <div className="border border-white/[0.07] bg-gradient-to-r from-panel to-slate-950/80 flex flex-row items-center justify-between px-5 py-4 w-full hover:border-brand/30 hover:shadow-lg transition-all duration-300 rounded-2xl">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-brand/10 border border-brand/20 flex items-center justify-center">
              <Bot size={13} className="text-brand animate-pulse" />
            </div>
            <div>
              <span className="text-xs font-bold text-slate-200 uppercase tracking-widest leading-none block">AI Scheduling Assistant</span>
              <span className="text-[10px] text-slate-500 mt-1 block">Context-aware timetable co-pilot</span>
            </div>
          </div>
          <button className="text-[10px] font-bold text-brand hover:text-brand-light flex items-center gap-1.5 cursor-pointer select-none">
            Expand Assistant <Maximize2 size={10} />
          </button>
        </div>
      </div>
    );
  }

  // ── Expanded state ───────────────────────────────────────────────────────
  return (
    <div className="no-print mt-8 bg-gradient-to-br from-panel/90 to-slate-950/70 border border-white/[0.08] rounded-3xl shadow-2xl overflow-hidden relative backdrop-blur-xl animate-fade-in transition-all duration-300">
      {/* Glow */}
      <div className="absolute -top-12 -right-12 w-64 h-64 bg-brand/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4.5 shrink-0 relative z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand via-brand to-brand-light flex items-center justify-center shadow-lg shadow-brand/10">
            <Bot size={15} className="text-white" />
          </div>
          <div>
            <p className="text-xs font-black text-slate-200 uppercase tracking-widest leading-none">AI Scheduling Agent</p>
            <p className="text-[10px] text-slate-500 mt-1">Tool-calling · Live context-aware timetable assistant</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold border ${sessionCalls >= MAX_CALLS ? 'bg-red-500/10 text-red-400' : sessionCalls > 40 ? 'bg-amber-500/10 text-amber-400' : 'bg-brand/10 text-brand'}`}>
            {sessionCalls}/{MAX_CALLS} queries
          </span>
          {/* Tabs */}
          <div className="flex bg-white/[0.03] border border-white/[0.06] rounded-xl p-0.5">
            {(['chat', 'coach'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold capitalize transition-all select-none cursor-pointer ${activeTab === tab ? 'bg-brand/25 text-brand-light border border-brand/20' : 'text-slate-500 hover:text-slate-300 border border-transparent'}`}
              >
                {tab === 'chat' ? '💬 Chat' : '🎓 Coach'}
              </button>
            ))}
          </div>
          <button onClick={() => setIsCollapsed(true)} className="p-1.5 rounded-xl hover:bg-white/[0.06] text-slate-500 hover:text-slate-300 transition-all cursor-pointer" title="Collapse">
            <Minimize2 size={14} />
          </button>
        </div>
      </div>

      {/* ── Chat Tab ──────────────────────────────────────────────────── */}
      {activeTab === 'chat' && (
        <div className="flex flex-col h-[480px]">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4.5 min-h-0 scrollbar-thin animate-fade-in">
            {messages.map((msg, i) => {
              const isLastMessage = i === messages.length - 1;
              return (
                <div key={i} className={`flex gap-3.5 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`w-9 h-9 rounded-2xl flex items-center justify-center text-xs shrink-0 font-extrabold ${msg.role === 'user' ? 'bg-brand/20 text-brand-light border border-brand/35' : 'bg-gradient-to-br from-brand to-brand-light text-white shadow-md shadow-brand/10'}`}>
                    {msg.role === 'user' ? 'U' : <Bot size={15} />}
                  </div>
                  <div className="max-w-[82%] flex flex-col gap-1.5 relative group">
                    <div className={`rounded-3xl px-5 py-4 ${msg.role === 'user' ? 'bg-[#1a214d]/50 border border-brand/25 rounded-tr-none text-slate-100 shadow-md' : 'bg-[#111736]/65 border border-white/[0.06] border-l-4 border-l-brand rounded-tl-none text-slate-200 shadow-inner'}`}>
                      <RenderMarkdown text={msg.content} />
                    </div>
                    {/* Hover actions */}
                    {msg.role === 'assistant' && (
                      <div className="absolute right-3 top-3 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-[#111736]/90 border border-white/5 rounded-lg p-1 shadow-md">
                        <button
                          onClick={() => copyToClipboard(msg.content)}
                          className="p-1 hover:bg-white/[0.08] rounded text-slate-400 hover:text-white transition-colors cursor-pointer"
                          title="Copy to clipboard"
                        >
                          <Copy size={11} />
                        </button>
                        {isLastMessage && !loading && (
                          <button
                            onClick={handleRegenerate}
                            className="p-1 hover:bg-white/[0.08] rounded text-slate-400 hover:text-white transition-colors cursor-pointer"
                            title="Regenerate response"
                          >
                            <RotateCcw size={11} />
                          </button>
                        )}
                      </div>
                    )}
                    {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                      <div className="flex gap-1.5 flex-wrap mt-0.5">
                        {msg.toolsUsed.map((t, j) => (
                          <span key={j} className="text-[9px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 px-2 py-0.5 rounded-full flex items-center gap-1 font-bold">
                            🔧 {t}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* Follow-up suggestions */}
                    {isLastMessage && msg.role === 'assistant' && !loading && (
                      <div className="flex flex-wrap gap-2 mt-3 animate-fade-in">
                        {getFollowUpSuggestions(msg.content).map((suggestion, idx) => (
                          <button
                            key={idx}
                            onClick={() => sendMessage(suggestion)}
                            disabled={loading || sessionCalls >= MAX_CALLS}
                            className="px-3.5 py-1.5 rounded-full bg-[#1b2247]/40 hover:bg-[#202b5e]/60 border border-white/[0.08] hover:border-brand/35 text-[10px] font-bold text-brand-light hover:text-white transition-all cursor-pointer active:scale-95 select-none"
                          >
                            {suggestion} →
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {loading && (
              <div className="flex gap-3.5">
                <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-brand to-brand-light flex items-center justify-center shrink-0">
                  <Bot size={15} className="text-white animate-pulse" />
                </div>
                <div className="bg-[#111736]/65 border border-white/[0.06] rounded-3xl rounded-tl-none px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Loader2 size={13} className="animate-spin text-brand-light" />
                    <span className="text-xs text-slate-400 italic font-mono">{thinkingText}</span>
                  </div>
                  <button
                    onClick={() => {
                      if (abortControllerRef.current) abortControllerRef.current.abort();
                    }}
                    className="text-[10px] bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 border border-red-500/25 px-2.5 py-1 rounded-lg flex items-center gap-1.5 font-bold transition-all cursor-pointer self-start sm:self-center select-none"
                  >
                    <X size={11} /> Stop
                  </button>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Fresh Conversation suggestion chips */}
          {messages.length <= 1 && !input.trim() && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-6 pb-4">
              {QUICK_ACTIONS.map((qa, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(qa.msg)}
                  disabled={loading || sessionCalls >= MAX_CALLS}
                  className="text-left p-3.5 rounded-2xl bg-[#111633]/55 border border-white/[0.06] hover:border-brand-light/30 hover:bg-[#151c42]/60 hover:shadow-lg hover:shadow-brand/5 transition-all cursor-pointer group text-xs relative overflow-hidden"
                >
                  <div className="flex items-start gap-2.5">
                    <div className="p-2 rounded-xl bg-brand/10 text-brand-light group-hover:bg-brand/20 transition-all shrink-0 mt-0.5">
                      {qa.icon}
                    </div>
                    <div>
                      <p className="font-bold text-slate-200 group-hover:text-brand-light transition-colors">{qa.label}</p>
                      <p className="text-[10px] text-slate-500 mt-1 leading-normal">{qa.msg}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Input pill */}
          <div className="px-6 pb-4 pt-4 flex flex-col gap-2 border-t border-white/[0.05] bg-[#0c102b]/40 shrink-0">
            <div className="relative flex items-end bg-[#070b1f] border border-white/[0.08] hover:border-brand/40 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15 rounded-2xl p-2 transition-all duration-200">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => {
                  setInput(e.target.value);
                  const tx = textareaRef.current;
                  if (tx) {
                    tx.style.height = 'auto';
                    tx.style.height = `${Math.min(tx.scrollHeight, 140)}px`;
                  }
                }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
                placeholder={sessionCalls >= MAX_CALLS ? 'Session limit reached.' : 'Ask AI to optimize, solve conflicts, check workloads...'}
                disabled={loading || sessionCalls >= MAX_CALLS}
                rows={1}
                className="w-full bg-transparent resize-none pl-3 pr-14 py-2.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none disabled:opacity-50"
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || loading || sessionCalls >= MAX_CALLS}
                className="absolute right-2 bottom-2 w-9 h-9 rounded-xl bg-gradient-to-br from-brand via-brand to-brand-light flex items-center justify-center disabled:opacity-35 disabled:cursor-not-allowed hover:scale-[1.05] active:scale-90 hover:shadow-lg hover:shadow-brand/20 transition-all duration-200 cursor-pointer select-none"
                title="Send"
              >
                {loading ? <Loader2 size={13} className="animate-spin text-white" /> : <Send size={13} className="text-white" />}
              </button>
            </div>
            <div className="text-[10px] text-slate-500 font-mono flex justify-between px-2 shrink-0">
              <span>{input.length} characters</span>
              <span className={sessionCalls >= MAX_CALLS ? 'text-red-400 font-bold' : sessionCalls > 40 ? 'text-amber-400' : 'text-slate-500'}>
                {sessionCalls} / {MAX_CALLS} session calls used
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Coach Tab ─────────────────────────────────────────────────── */}
      {activeTab === 'coach' && (
        <div className="flex-1 flex flex-col gap-4.5 p-6 h-[480px] bg-gradient-to-br from-[#1b1f38]/40 via-transparent to-transparent">
          <div className="flex items-center justify-between shrink-0 bg-[#121630] border border-white/[0.04] p-4 rounded-2xl shadow-inner">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-400">
                <Sparkles size={16} />
              </div>
              <div>
                <p className="text-xs font-bold text-amber-400 uppercase tracking-wider leading-none">Automated Step Coach</p>
                <p className="text-[10px] text-slate-400 mt-1">Automated guidelines for Step {currentStep}</p>
              </div>
            </div>
            <button
              onClick={loadCoachTip}
              disabled={tipLoading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/25 text-[10px] font-bold text-amber-400 hover:bg-amber-500/20 transition-all active:scale-95 disabled:opacity-50 cursor-pointer select-none"
            >
              {tipLoading ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
              {tipLoaded ? 'Refresh Tips' : 'Load Tips'}
            </button>
          </div>

          {!tipLoaded && !tipLoading && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3.5 text-center">
              <div className="w-11 h-11 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shadow-lg shadow-amber-500/5 animate-bounce">
                <Sparkles size={18} className="text-amber-400" />
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-300">Tips Not Loaded</p>
                <p className="text-[10px] text-slate-500 mt-1">Get custom automated scheduling advice for Step {currentStep}</p>
              </div>
            </div>
          )}

          {tipLoading && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3.5 text-slate-400">
              <Loader2 size={20} className="animate-spin text-brand" />
              <span className="text-xs italic">Analyzing timetabling parameters…</span>
            </div>
          )}

          {tipLoaded && tip && (
            <div className="flex-1 bg-white/[0.01] border border-white/[0.05] rounded-2xl p-4.5 overflow-y-auto min-h-0 shadow-inner">
              <RenderMarkdown text={tip} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
