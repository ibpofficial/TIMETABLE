import { useState, useRef, useEffect } from 'react';
import {
  Sparkles, Send, Minimize2, Maximize2, Loader2,
  Zap, Users, Building, AlertTriangle, Bot
} from 'lucide-react';
import { useTimetableStore } from '../store/useTimetableStore';
import { fetchAiTip, fetchAiAgent } from '../api/client';
import { Card } from './ui';

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

  // Coach state
  const [tip, setTip] = useState('');
  const [tipLoading, setTipLoading] = useState(false);
  const [tipLoaded, setTipLoaded] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset coach on step change
  useEffect(() => { setTipLoaded(false); setTip(''); }, [currentStep]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

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

    setInput('');
    const userMsg: ChatMessage = { role: 'user', content: userText, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    setSessionCalls(c => c + 1);

    try {
      // Build conversation history (last 8 messages for context)
      const history = [...messages.slice(-8), userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const { reply, toolsUsed } = await fetchAiAgent(history, buildStoreSnapshot());
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: reply,
        toolsUsed,
        timestamp: new Date(),
      }]);
    } catch (err: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ **Error**: ${err.message || 'Failed to reach the AI agent. Ensure the backend is running.'}`,
        timestamp: new Date(),
      }]);
    } finally {
      setLoading(false);
    }
  };

  const loadCoachTip = async () => {
    if (tipLoading) return;
    setTipLoading(true);
    try {
      const context = {
        days: store.days, startTime: store.startTime, endTime: store.endTime,
        slotLength: store.slotLength, maxClassesPerDay: store.maxClassesPerDay,
        theoryRoomsCount: store.theoryRooms.length, labRoomsCount: store.labRooms.length,
        batchesCount: store.batches.length, facultiesCount: store.faculties.length,
        subjectsCount: store.subjects.length, departmentsCount: store.departments.length,
      };
      const res = await fetchAiTip(`step_${currentStep}`, {}, context);
      setTip(res.reply);
      setTipLoaded(true);
    } catch (err: any) {
      setTip(`⚠️ Could not load tip: ${err.message}`);
      setTipLoaded(true);
    } finally {
      setTipLoading(false);
    }
  };

  // ── Collapsed state ──────────────────────────────────────────────────────
  if (isCollapsed) {
    return (
      <div className="no-print w-full cursor-pointer" onClick={() => setIsCollapsed(false)}>
        <Card className="border-[#28305a]/60 bg-gradient-to-r from-[#0e1430] to-[#0a0f24] flex flex-row items-center justify-between px-4 py-2.5 w-full hover:border-brand/30 transition-all">
          <div className="flex items-center gap-2.5">
            <Bot size={14} className="text-brand animate-pulse" />
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">AI Scheduling Agent</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${sessionCalls >= MAX_CALLS ? 'bg-red-500/20 text-red-400' : 'bg-brand/20 text-brand'}`}>
              {sessionCalls}/{MAX_CALLS} queries
            </span>
          </div>
          <button className="text-[10px] font-bold text-brand hover:text-brand-light flex items-center gap-1">
            Expand <Maximize2 size={10} />
          </button>
        </Card>
      </div>
    );
  }

  // ── Expanded state ───────────────────────────────────────────────────────
  return (
    <Card className="border-[#28305a]/60 bg-gradient-to-br from-[#0e1430] to-[#0a0f24] relative overflow-hidden flex flex-col w-full no-print min-h-[420px]">
      {/* Glow */}
      <div className="absolute top-0 right-0 w-48 h-48 bg-brand/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand to-brand-light flex items-center justify-center shadow-md">
            <Bot size={13} className="text-white" />
          </div>
          <div>
            <p className="text-xs font-black text-slate-200 uppercase tracking-widest">AI Scheduling Agent</p>
            <p className="text-[10px] text-slate-500">Tool-calling · Context-aware · Live data</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-[10px] px-2 py-1 rounded-full font-bold border ${sessionCalls >= MAX_CALLS ? 'bg-red-500/10 text-red-400 border-red-500/20' : sessionCalls > 40 ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-brand/10 text-brand border-brand/20'}`}>
            {sessionCalls}/{MAX_CALLS} queries
          </span>
          {/* Tabs */}
          <div className="flex bg-white/[0.04] rounded-lg p-0.5">
            {(['chat', 'coach'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1 rounded-md text-[11px] font-bold capitalize transition-all ${activeTab === tab ? 'bg-brand/20 text-brand' : 'text-slate-500 hover:text-slate-300'}`}
              >
                {tab === 'chat' ? '💬 Chat' : '🎓 Coach'}
              </button>
            ))}
          </div>
          <button onClick={() => setIsCollapsed(true)} className="p-1.5 rounded-lg hover:bg-white/[0.06] text-slate-500 hover:text-slate-300 transition-colors" title="Collapse">
            <Minimize2 size={14} />
          </button>
        </div>
      </div>

      {/* ── Chat Tab ──────────────────────────────────────────────────── */}
      {activeTab === 'chat' && (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 min-h-[240px] max-h-[340px]">
            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs shrink-0 ${msg.role === 'user' ? 'bg-brand/20 text-brand font-black' : 'bg-white/[0.06] text-slate-400'}`}>
                  {msg.role === 'user' ? 'U' : <Bot size={12} />}
                </div>
                <div className={`max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                  <div className={`rounded-2xl px-3.5 py-2.5 ${msg.role === 'user' ? 'bg-brand/15 border border-brand/20 rounded-tr-sm' : 'bg-white/[0.04] border border-white/[0.06] rounded-tl-sm'}`}>
                    <RenderMarkdown text={msg.content} />
                  </div>
                  {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {msg.toolsUsed.map((t, j) => (
                        <span key={j} className="text-[9px] font-mono bg-green-500/10 text-green-400 border border-green-500/20 px-1.5 py-0.5 rounded-full">
                          🔧 {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex gap-2.5">
                <div className="w-7 h-7 rounded-xl bg-white/[0.06] flex items-center justify-center">
                  <Bot size={12} className="text-slate-400" />
                </div>
                <div className="bg-white/[0.04] border border-white/[0.06] rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
                  <Loader2 size={13} className="animate-spin text-brand" />
                  <span className="text-xs text-slate-400 italic">Querying live data…</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Quick action buttons */}
          <div className="px-4 pb-2 flex flex-wrap gap-1.5">
            {QUICK_ACTIONS.map((qa, i) => (
              <button
                key={i}
                onClick={() => sendMessage(qa.msg)}
                disabled={loading || sessionCalls >= MAX_CALLS}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.07] text-[11px] text-slate-400 hover:text-slate-200 hover:bg-white/[0.07] hover:border-brand/20 transition-all; disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {qa.icon}
                {qa.label}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="px-4 pb-4 pt-1 flex gap-2 items-center border-t border-white/[0.06] shrink-0">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
              placeholder={sessionCalls >= MAX_CALLS ? 'Session limit reached.' : 'Ask about faculty loads, room conflicts, scheduling failures…'}
              disabled={loading || sessionCalls >= MAX_CALLS}
              className="flex-1 bg-white/[0.04] border border-white/[0.07] rounded-xl px-3.5 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-brand/40 focus:border-brand/30 transition-all disabled:opacity-50"
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading || sessionCalls >= MAX_CALLS}
              className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand to-brand-light flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity shadow-md"
              title="Send"
            >
              {loading ? <Loader2 size={15} className="animate-spin text-white" /> : <Send size={15} className="text-white" />}
            </button>
          </div>
        </>
      )}

      {/* ── Coach Tab ─────────────────────────────────────────────────── */}
      {activeTab === 'coach' && (
        <div className="flex-1 flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-slate-200">Step {currentStep} Coach Instructions</p>
              <p className="text-xs text-slate-500">On-demand tips for the current wizard step</p>
            </div>
            <button
              onClick={loadCoachTip}
              disabled={tipLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand/10 border border-brand/20 text-xs font-bold text-brand hover:bg-brand/20 transition-all disabled:opacity-50"
            >
              {tipLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {tipLoaded ? 'Refresh Tips' : 'Load AI Coach Tips'}
            </button>
          </div>

          {!tipLoaded && !tipLoading && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
              <div className="w-12 h-12 rounded-2xl bg-brand/10 border border-brand/20 flex items-center justify-center">
                <Sparkles size={20} className="text-brand" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-300">Coach Tips Not Loaded</p>
                <p className="text-xs text-slate-500 mt-1">Click "Load AI Coach Tips" to get contextual advice for Step {currentStep}</p>
              </div>
            </div>
          )}

          {tipLoading && (
            <div className="flex-1 flex items-center justify-center gap-2 text-slate-400">
              <Loader2 size={18} className="animate-spin text-brand" />
              <span className="text-sm">Generating step-specific coach instructions…</span>
            </div>
          )}

          {tipLoaded && tip && (
            <div className="flex-1 bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 overflow-y-auto">
              <RenderMarkdown text={tip} />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

