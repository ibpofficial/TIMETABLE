import { useEffect, useState, useRef } from 'react';
import { Sparkles, RefreshCw, Loader2, Send, Minimize2, Maximize2 } from 'lucide-react';
import { useTimetableStore } from '../store/useTimetableStore';
import { fetchAiTip } from '../api/client';
import { Card } from './ui';

const BACKEND_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? `${window.location.protocol}//${window.location.hostname}:5000`
  : 'http://localhost:5000';

export function AiPanel() {
  const store = useTimetableStore();
  const { currentStep } = store;

  // Panel state
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<'coach' | 'chat'>('coach');
  
  // Coach states
  const [tip, setTip] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [tipLoaded, setTipLoaded] = useState(false);

  // Chat states
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([
    { role: 'assistant', content: "### Welcome to Copilot Chat 🗓️\n* I'm your context-aware timetable assistant.\n* Ask me to **check constraints** or **recommend sizes**.\n* I answer queries *only* regarding your timetable." }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  const cacheRef = useRef<Record<number, string>>({});
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Reset coach tip loaded state on step change (no auto-loads, wait for user trigger)
  useEffect(() => {
    setTipLoaded(false);
    setTip('');
  }, [currentStep]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chatLoading]);

  // Custom Inline Markdown Parsing & Styling Engine
  const parseInlineMarkdown = (str: string) => {
    let txt = str.replace(/->/g, ' ➔ ');
    const parts = txt.split('**');
    return parts.map((part, idx) => {
      if (idx % 2 === 1) {
        return <strong key={idx} className="font-extrabold text-brand-light">{part}</strong>;
      }
      return part;
    });
  };

  const renderContent = (text: string) => {
    return text.split('\n').filter(Boolean).map((line, i) => {
      let content = line.trim();
      
      // 1. Headers
      if (content.startsWith('### ')) {
        return (
          <h4 key={i} className="font-bold text-slate-100 mt-3 mb-1 text-xs border-l-2 border-brand pl-2">
            {parseInlineMarkdown(content.substring(4))}
          </h4>
        );
      }
      if (content.startsWith('## ') || content.startsWith('# ')) {
        const depth = content.startsWith('## ') ? 3 : 2;
        return (
          <h3 key={i} className="font-extrabold text-brand-light mt-3.5 mb-1.5 text-xs uppercase tracking-wider">
            {parseInlineMarkdown(content.substring(depth === 3 ? 3 : 2))}
          </h3>
        );
      }

      // 2. Bullet lists
      if (content.startsWith('* ') || content.startsWith('- ')) {
        return (
          <div key={i} className="flex gap-2 items-start pl-2.5 text-xs text-slate-300 my-1 font-medium leading-relaxed">
            <span className="text-brand shrink-0">➔</span>
            <span>{parseInlineMarkdown(content.substring(2))}</span>
          </div>
        );
      }

      // 3. Numbered lists (e.g. "1. ")
      const numMatch = content.match(/^(\d+)\.\s(.*)/);
      if (numMatch) {
        return (
          <div key={i} className="flex gap-2 items-start pl-2.5 text-xs text-slate-300 my-1 font-medium leading-relaxed font-mono">
            <span className="text-brand-light font-bold">{numMatch[1]}.</span>
            <span>{parseInlineMarkdown(numMatch[2])}</span>
          </div>
        );
      }

      // 4. Standard Paragraph
      return (
        <p key={i} className="text-xs text-slate-300 my-1.5 leading-relaxed font-medium">
          {parseInlineMarkdown(content)}
        </p>
      );
    });
  };

  const loadTip = async (force = false) => {
    if (!force && cacheRef.current[currentStep]) {
      setTip(cacheRef.current[currentStep]);
      setTipLoaded(true);
      return;
    }

    setLoading(true);
    
    const context = {
      days: store.days,
      startTime: store.startTime,
      endTime: store.endTime,
      slotLength: store.slotLength,
      maxClassesPerDay: store.maxClassesPerDay,
      theoryRoomsCount: store.theoryRooms.length,
      labRoomsCount: store.labRooms.length,
      batchesCount: store.batches.length,
      facultiesCount: store.faculties.length,
      subjectsCount: store.subjects.length,
      breaksCount: store.breaks.length,
      eventsCount: store.events.length,
    };

    const stepLabel =
      currentStep === 1 ? 'Institution & Infrastructure' :
      currentStep === 2 ? 'Student Batches' :
      currentStep === 3 ? 'Faculty Constraints' :
      currentStep === 4 ? 'Subjects & Course constraints' :
      currentStep === 5 ? 'Breaks & Fixed Events' :
      currentStep === 6 ? 'Review & Solver Settings' :
      'Results view';

    try {
      const result = await fetchAiTip(
        'step_changed',
        { currentStep, stepLabel },
        context
      );
      
      setTip(result.reply);
      cacheRef.current[currentStep] = result.reply;
      setTipLoaded(true);
    } catch (err: any) {
      console.error('AI Tip loading error:', err);
      const fallback = currentStep === 1 
        ? '💡 **Tip**: Aim to provide a slot size (e.g. 60m) that aligns with standard period intervals.\n* Ensure you configure enough classrooms so multiple batches can have classes in parallel.'
        : currentStep === 2
        ? '💡 **Tip**: Keep batch names distinct and simple.\n* You will associate subjects and students with these groups in subsequent steps.'
        : currentStep === 3
        ? '💡 **Tip**: Add unavailability constraints only where necessary.\n* Over-blocking faculty slots reduces the solver\'s search domain, increasing likelihood of conflict failures.'
        : currentStep === 4
        ? '💡 **Tip**: When setting up practical labs of session length > 1, make sure you have sufficient lab room availability configured in Step 1.'
        : currentStep === 5
        ? '💡 **Tip**: Place lunch breaks in the middle of instruction hours.\n* Fixed events will book all student batches globally, preventing subject assignments in those slots.'
        : currentStep === 6
        ? '💡 **Tip**: If generation fails, reduce weekly classes, add more classrooms, or use the AI suggest panel in Results to locate bottlenecks.'
        : '💡 **Tip**: Print this page to get a clean layout or download CSV data to edit your scheduling setup locally in sheets.';

      setTip(fallback);
      cacheRef.current[currentStep] = fallback;
      setTipLoaded(true);
    } finally {
      setLoading(false);
    }
  };

  const handleSendChat = async () => {
    const q = chatInput.trim();
    if (!q) return;

    const newMsgs = [...messages, { role: 'user' as const, content: q }];
    setMessages(newMsgs);
    setChatInput('');
    setChatLoading(true);

    const context = {
      days: store.days,
      startTime: store.startTime,
      endTime: store.endTime,
      slotLength: store.slotLength,
      maxClassesPerDay: store.maxClassesPerDay,
      rooms: {
        theoryList: store.theoryRooms,
        labList: store.labRooms
      },
      batches: store.batches,
      batchSizes: store.batchSizes || {},
      faculties: store.faculties,
      subjects: store.subjects,
      breaks: store.breaks,
      events: store.events,
      hasSolution: !!store.solution
    };

    const sysPrompt = [
      'You are a conversational timetable AI assistant embedded in a university timetable builder.',
      'CRITICAL: If asked who created you or who made you, you MUST answer: "ISHANT UPADHYAY created me". Do not say anyone else.',
      'Format output using markdown headings with hashtags (# or ##) and bullet lists with asterisks (*).',
      'Use bold (**text**) for key terms and pointing arrows (->) for transitions.',
      'Include contextual emojis for emphasis.',
      'Keep responses extremely brief, structured, and easy to read. Avoid long paragraphs.',
      'Answer questions ONLY about the current timetable configuration and scheduling mathematical logic.'
    ].join(' ');

    const payload = [
      { role: 'system' as const, content: sysPrompt },
      ...newMsgs.map(m => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: `Current configuration context: ${JSON.stringify(context)}` }
    ];

    try {
      const res = await fetch(`${BACKEND_BASE}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: payload })
      });
      if (!res.ok) throw new Error('AI request failed.');
      const data = await res.json();
      setMessages([...newMsgs, { role: 'assistant' as const, content: data.reply }]);
    } catch (err: any) {
      console.error(err);
      setMessages([...newMsgs, { role: 'assistant' as const, content: '⚠️ Failed to connect to AI server. Please make sure the backend is running.' }]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSendChat();
  };

  const stepLabel =
    currentStep === 1 ? 'Institution & Time' :
    currentStep === 2 ? 'Student Batches' :
    currentStep === 3 ? 'Faculty Constraints' :
    currentStep === 4 ? 'Subjects & Courses' :
    currentStep === 5 ? 'Breaks & Fixed Events' :
    currentStep === 6 ? 'Review & Solver Settings' :
    'Results Solution';

  // ── Render Collapsed State ──────────────────────────────────────────
  if (isCollapsed) {
    return (
      <div
        className="no-print w-full cursor-pointer"
        onClick={() => setIsCollapsed(false)}
      >
        <Card className="border-[#28305a]/60 bg-gradient-to-br from-[#0e1430] to-[#0a0f24] relative overflow-hidden flex flex-col p-3.5 w-full hover:border-brand/30 transition-all">
          <div className="flex justify-between items-center w-full">
            <div className="flex items-center gap-2.5">
              <div className="w-2 h-2 rounded-full bg-brand animate-pulse shrink-0" />
              <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5 uppercase tracking-wider">
                ✨ AI Scheduling Copilot & Assistant (Collapsed)
              </h3>
            </div>
            <button className="text-[10px] font-bold text-brand hover:text-brand-light flex items-center gap-1">
              Expand Panel <Maximize2 size={10} />
            </button>
          </div>
        </Card>
      </div>
    );
  }

  // ── Render Expanded State ───────────────────────────────────────────
  return (
    <Card className="border-[#28305a]/60 bg-gradient-to-br from-[#0e1430] to-[#0a0f24] relative overflow-hidden flex flex-col min-h-[420px] max-h-[600px] p-5 w-full">
      {/* Decorative background glow */}
      <div className="absolute -right-16 -top-16 w-48 h-48 rounded-full bg-brand/10 blur-2xl pointer-events-none" />

      {/* Header and Toggle Tabs */}
      <div className="flex justify-between items-center mb-4 border-b border-white/5 pb-2.5 shrink-0">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('coach')}
            className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg transition-colors
              ${activeTab === 'coach' ? 'bg-brand/25 text-brand-light border border-brand/20' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Coach Instructions
          </button>
          <button
            onClick={() => setActiveTab('chat')}
            className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg transition-colors
              ${activeTab === 'chat' ? 'bg-brand/25 text-brand-light border border-brand/20' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Interactive AI Copilot Chat
          </button>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'coach' && tipLoaded && (
            <button
              onClick={() => loadTip(true)}
              disabled={loading}
              className="p-1.5 rounded-lg hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-50"
              title="Refresh AI suggestions"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
          )}
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1.5 rounded-lg hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-colors"
            title="Minimize AI Panel"
          >
            <Minimize2 size={12} />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto min-h-[260px] flex flex-col">
        {activeTab === 'coach' ? (
          <div className="flex flex-col justify-center py-4 flex-1">
            {loading ? (
              <div className="flex flex-col items-center justify-center gap-2 py-4 text-slate-500">
                <Loader2 className="animate-spin text-brand/60" size={18} />
                <span className="text-[10px] font-mono tracking-wider">Analyzing state...</span>
              </div>
            ) : !tipLoaded ? (
              <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
                <p className="text-xs text-slate-400 max-w-sm leading-normal">
                  Coach suggestions analyze your scheduling setup for Step {currentStep} ({stepLabel}) to identify resource blockages and optimization opportunities.
                </p>
                <button
                  onClick={() => loadTip(false)}
                  className="bg-brand/20 border border-brand/35 text-brand-light hover:bg-brand/30 text-xs px-4 py-2.5 rounded-xl font-bold transition-all shadow-md shadow-brand/10 flex items-center gap-2"
                >
                  <Sparkles size={13} />
                  Load AI Coach Instructions
                </button>
              </div>
            ) : (
              <div className="space-y-2 text-xs leading-relaxed text-slate-300 font-medium animate-fade-in">
                {renderContent(tip)}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col flex-1">
            <div className="flex-1 overflow-y-auto space-y-2.5 mb-3 pr-1 max-h-[380px]">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`p-3 rounded-xl text-xs max-w-[85%] leading-normal
                    ${m.role === 'user'
                      ? 'bg-slate-800 text-slate-100 ml-auto'
                      : 'bg-brand/10 border border-brand/20 text-slate-200'}`}
                >
                  {renderContent(m.content)}
                </div>
              ))}
              {chatLoading && (
                <div className="bg-brand/5 border border-brand/10 p-2.5 rounded-xl text-xs max-w-[85%] text-slate-400 flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin text-brand" /> Copilot is thinking...
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input form */}
            <div className="flex gap-2 border-t border-white/5 pt-3 mt-auto shrink-0 font-sans">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask your timetable copilot a question or ask it to check constraints..."
                className="flex-1 bg-[#121832] border border-white/10 rounded-lg px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-brand font-medium"
              />
              <button
                onClick={handleSendChat}
                disabled={chatLoading}
                className="bg-brand text-white px-3.5 py-2 rounded-lg hover:bg-brand-light transition-colors disabled:opacity-50 flex items-center justify-center"
              >
                <Send size={12} />
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-2 pt-2 border-t border-white/[0.04] flex items-center justify-between text-[8px] text-slate-600 shrink-0">
        <span className="flex items-center gap-1">
          <Sparkles size={8} /> Active context aware
        </span>
        <span>Step {currentStep} of 7</span>
      </div>
    </Card>
  );
}
