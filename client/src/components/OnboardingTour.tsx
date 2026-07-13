import { useState } from 'react';
import { Sparkles, Bot, Calendar, Landmark, Users, ChevronRight, ChevronLeft, X } from 'lucide-react';

interface Slide {
  title: string;
  desc: string;
  icon: React.ReactNode;
}

export function OnboardingTour({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [currentSlide, setCurrentSlide] = useState(0);

  const slides: Slide[] = [
    {
      title: 'Welcome to IBP Timetable Generator! 🚀',
      desc: 'Build constraint-aware timetable schedules for your departments, rooms, faculties, and student classes in 7 simple steps.',
      icon: <Calendar size={32} className="text-brand-light animate-pulse" />,
    },
    {
      title: '1. Set Up Days & Classrooms 🏫',
      desc: 'Configure days, timeslots, and room resources (Step 1). You can also import classroom and lab databases directly using Excel sheets.',
      icon: <Landmark size={32} className="text-indigo-400" />,
    },
    {
      title: '2. Register Faculty & Batches 👥',
      desc: 'Declare student batches and faculty profiles (Steps 2, 3). Assign maximum weekly teaching slot caps and individual faculty leaves.',
      icon: <Users size={32} className="text-emerald-400" />,
    },
    {
      title: '3. Co-Pilot with AI Scheduling Agent 🤖',
      desc: 'Our built-in co-pilot queries your live timetable setup snap to highlight issues, draft recommendations, or resolve constraint solver failures.',
      icon: <Bot size={32} className="text-cyan-400" />,
    },
    {
      title: '4. Solve & Print Timetables ⚡',
      desc: 'Configure options, run genetic solver, and inspect generated schedules (Steps 6, 7). Use PDF, CSV, or custom print modes to share setups!',
      icon: <Sparkles size={32} className="text-amber-400" />,
    },
  ];

  const handleNext = () => {
    if (currentSlide === slides.length - 1) {
      completeTour();
    } else {
      setCurrentSlide(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentSlide > 0) {
      setCurrentSlide(prev => prev - 1);
    }
  };

  const completeTour = () => {
    localStorage.setItem('ibp_tour_completed', 'true');
    onClose();
  };

  if (!isOpen) return null;

  const active = slides[currentSlide];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in animate-slide-up" style={{ zIndex: 99999 }}>
      <div className="bg-[#0b0e22]/95 border border-white/[0.08] rounded-3xl w-full max-w-md p-6.5 shadow-2xl relative animate-pop-in overflow-hidden">
        {/* Glow */}
        <div className="absolute -top-16 -right-16 w-48 h-48 bg-brand/5 rounded-full blur-3xl pointer-events-none" />

        {/* Skip button */}
        <button
          onClick={completeTour}
          className="absolute right-4.5 top-4.5 p-1.5 rounded-xl hover:bg-white/[0.06] text-slate-500 hover:text-slate-300 transition-all cursor-pointer"
          title="Skip Tour"
        >
          <X size={15} />
        </button>

        {/* Content body */}
        <div className="flex flex-col items-center text-center py-6 gap-4">
          <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center shadow-lg">
            {active.icon}
          </div>
          <div className="space-y-2 px-1">
            <h3 className="text-base font-extrabold text-slate-100">{active.title}</h3>
            <p className="text-xs text-slate-400 leading-relaxed font-medium">{active.desc}</p>
          </div>
        </div>

        {/* Navigation row */}
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-white/[0.05]">
          <span className="text-[10px] text-slate-500 font-mono">
            Step {currentSlide + 1} of {slides.length}
          </span>

          <div className="flex gap-2">
            {currentSlide > 0 && (
              <button
                onClick={handlePrev}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] text-xs font-semibold text-slate-400 hover:text-slate-200 transition-all cursor-pointer"
              >
                <ChevronLeft size={13} /> Back
              </button>
            )}
            <button
              onClick={handleNext}
              className="flex items-center gap-1 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-brand to-brand-light text-xs font-bold text-white hover:scale-[1.03] active:scale-95 transition-all shadow-md shadow-brand/10 cursor-pointer"
            >
              {currentSlide === slides.length - 1 ? 'Finish' : 'Next'} <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
