import { useEffect, useState, useRef } from 'react';
import { Brain, Sparkles, RefreshCw, Loader2 } from 'lucide-react';
import { useTimetableStore } from '../store/useTimetableStore';
import { fetchAiTip } from '../api/client';
import { Card } from './ui';

export function AiPanel() {
  const store = useTimetableStore();
  const { currentStep } = store;

  const [tip, setTip] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // Cache tips per step to prevent redundant API queries and respect rate-limiting
  const cacheRef = useRef<Record<number, string>>({});

  const loadTip = async (force = false) => {
    if (!force && cacheRef.current[currentStep]) {
      setTip(cacheRef.current[currentStep]);
      return;
    }

    setLoading(true);
    
    // Prepare contextual payload for the current wizard step
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
    } catch (err: any) {
      console.error('AI Tip loading error:', err);
      // Fallback message if OpenRouter key is missing or rate limited
      const fallback = currentStep === 1 
        ? '💡 Tip: Aim to provide a slot size (e.g. 60m) that aligns with standard period intervals. Ensure you configure enough classrooms so multiple batches can have classes in parallel.'
        : currentStep === 2
        ? '💡 Tip: Keep batch names distinct and simple. You will associate subjects and students with these groups in subsequent steps.'
        : currentStep === 3
        ? '💡 Tip: Add unavailability constraints only where necessary. Over-blocking faculty slots reduces the solver\'s search domain, increasing likelihood of conflict failures.'
        : currentStep === 4
        ? '💡 Tip: When setting up practical labs of session length > 1, make sure you have sufficient lab room availability configured in Step 1.'
        : currentStep === 5
        ? '💡 Tip: Place lunch breaks in the middle of instruction hours. Fixed events will book all student batches globally, preventing subject assignments in those slots.'
        : currentStep === 6
        ? '💡 Tip: If generation fails, reduce weekly classes, add more classrooms, or use the AI suggest panel in Results to locate bottlenecks.'
        : '💡 Tip: Print this page to get a clean layout or download CSV data to edit your scheduling setup locally in sheets.';

      setTip(fallback);
      cacheRef.current[currentStep] = fallback;
    } finally {
      setLoading(false);
    }
  };

  // Watch step changes to load tip
  useEffect(() => {
    loadTip();
  }, [currentStep]);

  return (
    <Card className="border-[#28305a]/60 bg-gradient-to-br from-[#0e1430] to-[#0a0f24] relative overflow-hidden">
      {/* Decorative background glow */}
      <div className="absolute -right-16 -top-16 w-36 h-36 rounded-full bg-brand/10 blur-2xl pointer-events-none" />

      <div className="flex justify-between items-center mb-3">
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-widest flex items-center gap-1.5">
          <Brain size={14} className="text-brand-light animate-pulse" />
          AI Copilot Coach
        </h3>
        <button
          onClick={() => loadTip(true)}
          disabled={loading}
          className="p-1 rounded hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-50"
          title="Refresh AI suggestions"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="min-h-[80px] flex flex-col justify-center">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-4 text-slate-500">
            <Loader2 className="animate-spin text-brand/60" size={18} />
            <span className="text-[10px] font-mono tracking-wider">Analyzing state...</span>
          </div>
        ) : (
          <div className="space-y-2 text-xs leading-relaxed text-slate-300 font-medium animate-fade-in">
            {tip.split('\n').filter(Boolean).map((line, i) => (
              <p key={i} className="flex gap-2 items-start">
                <span className="shrink-0">{line.match(/^[\p{Emoji}\u2600-\u27BF]/u) ? '' : '✨'}</span>
                <span>{line}</span>
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 pt-2.5 border-t border-white/[0.04] flex items-center justify-between text-[9px] text-slate-600">
        <span className="flex items-center gap-1">
          <Sparkles size={8} /> Active context aware
        </span>
        <span>Step {currentStep} of 7</span>
      </div>
    </Card>
  );
}
