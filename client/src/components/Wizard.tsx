import { useRef, useState } from 'react';
import { useTimetableStore, type WizardStep } from '../store/useTimetableStore';
import { CheckIcon, ChevronRight, ChevronLeft } from 'lucide-react';
import { Header } from './Header';
import { Step0Departments } from './steps/Step0Departments';
import { Step1Institution } from './steps/Step1Institution';
import { Step2Batches } from './steps/Step2Batches';
import { Step3Faculties } from './steps/Step3Faculties';
import { Step4Subjects } from './steps/Step4Subjects';
import { Step5Breaks } from './steps/Step5Breaks';
import { Step6Generate } from './steps/Step6Generate';
import { Step7Results } from './steps/Step7Results';
import { AiPanel } from './AiPanel';
import { TimetableHealthChecker } from './TimetableHealthChecker';

const STEPS = [
  { id: 0, label: 'Departments' },
  { id: 1, label: 'Institution & Time' },
  { id: 2, label: 'Batches' },
  { id: 3, label: 'Faculties' },
  { id: 4, label: 'Subjects' },
  { id: 5, label: 'Breaks & Events' },
  { id: 6, label: 'Review & Generate' },
  { id: 7, label: 'Results' },
] as const;

export function Wizard() {
  const { currentStep, setStep } = useTimetableStore();
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);

  // Keyboard navigation for step list
  const handleKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === 'ArrowDown' && idx < STEPS.length - 1) {
      stepRefs.current[idx + 1]?.focus();
    } else if (e.key === 'ArrowUp' && idx > 0) {
      stepRefs.current[idx - 1]?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      const step = STEPS[idx];
      setStep(step.id as WizardStep);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0 as WizardStep: return <Step0Departments />;
      case 1: return <Step1Institution />;
      case 2: return <Step2Batches />;
      case 3: return <Step3Faculties />;
      case 4: return <Step4Subjects />;
      case 5: return <Step5Breaks />;
      case 6: return <Step6Generate />;
      case 7: return <Step7Results />;
      default: return null;
    }
  };

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('stepper-collapsed') === 'true');
  const toggleCollapse = () => {
    setCollapsed(prev => {
      localStorage.setItem('stepper-collapsed', (!prev).toString());
      return !prev;
    });
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className={`flex-1 max-w-[1400px] mx-auto w-full px-4 sm:px-6 py-6 grid grid-cols-1 gap-6 print:block print:p-0 print:m-0 transition-all duration-300 ${collapsed ? 'lg:grid-cols-[70px_1fr]' : 'lg:grid-cols-[280px_1fr]'}`}>
        {/* Sidebar — Step Navigator */}
        <aside className={`lg:sticky lg:top-[80px] h-fit no-print transition-all duration-300 ${collapsed ? 'lg:w-[70px]' : 'lg:w-[280px]'}`}>
          <nav aria-label="Wizard steps">
            <div className="flex items-center justify-between mb-3.5 px-2">
              {!collapsed && <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest animate-fade-in">Schedule Steps</span>}
              <button
                onClick={toggleCollapse}
                className={`p-1.5 rounded-lg hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer border border-transparent hover:border-white/10 flex items-center justify-center
                  ${collapsed ? 'mx-auto' : 'ml-auto'}`}
                title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
              </button>
            </div>

            <ol
              role="tablist"
              aria-orientation="vertical"
              className="flex flex-row lg:flex-col gap-2 overflow-x-auto lg:overflow-x-visible pb-2 lg:pb-0"
            >
              {STEPS.map((step, idx) => {
                const isActive = step.id === currentStep;
                const isDone = step.id < currentStep;
                const isAccessible = true;

                return (
                  <li
                    key={step.id}
                    ref={(el) => { stepRefs.current[idx] = el; }}
                    role="tab"
                    aria-selected={isActive}
                    aria-controls={`step-panel-${step.id}`}
                    tabIndex={isAccessible ? 0 : -1}
                    onKeyDown={(e) => handleKeyDown(e, idx)}
                    onClick={() => setStep(step.id as WizardStep)}
                    title={collapsed ? `${idx + 1}. ${step.label}` : undefined}
                    className={`
                      group relative flex items-center gap-3.5 px-4 py-3.5 rounded-xl cursor-pointer
                      border transition-all duration-300 ease-out whitespace-nowrap lg:whitespace-normal
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand
                      ${collapsed ? 'lg:w-11 lg:h-11 lg:rounded-full lg:p-0 lg:mx-auto lg:justify-center' : ''}
                      ${isActive
                        ? 'bg-gradient-to-r from-slate-900/60 to-panel border-brand/30 text-white shadow-lg shadow-brand/5 scale-[1.01] translate-x-0 lg:translate-x-1 font-semibold'
                        : 'bg-panel/40 border-white/[0.04] text-slate-400 hover:text-slate-200 hover:border-white/10 hover:lg:translate-x-1'
                      }
                    `}
                  >
                    {/* Stepper connected vertical line */}
                    {idx < STEPS.length - 1 && !collapsed && (
                      <span
                        className="stepper-line absolute left-[30px] top-[38px] w-0.5 h-[calc(100%+8px)] -translate-x-1/2 pointer-events-none hidden lg:block z-0 transition-colors duration-300 bg-white/5"
                      />
                    )}

                    {/* Accent bar */}
                    <span
                      className={`absolute left-0 top-0 h-full w-1 rounded-l-xl bg-gradient-to-b from-brand to-brand-light transition-opacity duration-300
                        ${(isActive || isDone) && !collapsed ? 'opacity-100' : 'opacity-0'}`}
                    />

                    {/* Step number / check */}
                    <span className={`
                      flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-black z-10 transition-all duration-300
                      ${isActive ? 'bg-gradient-to-br from-brand to-brand-light text-white shadow-md shadow-brand/15 scale-110'
                        : isDone ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                        : 'bg-white/[0.03] text-slate-500 border border-white/5 group-hover:text-slate-300'}
                    `}>
                      {isDone ? <CheckIcon size={12} strokeWidth={3} /> : step.id}
                    </span>

                    <span className={`text-xs font-semibold uppercase tracking-wider transition-all duration-300 ${collapsed ? 'lg:opacity-0 lg:w-0 lg:overflow-hidden lg:pointer-events-none' : 'opacity-100'}`}>{step.label}</span>

                    {(isActive && !collapsed) && <ChevronRight size={13} className="ml-auto text-brand opacity-80 hidden lg:block animate-pulse" />}
                  </li>
                );
              })}
            </ol>
          </nav>
        </aside>

        {/* Main Content */}
        <div
          id={`step-panel-${currentStep}`}
          role="tabpanel"
          aria-labelledby={`step-tab-${currentStep}`}
          className="animate-slide-up min-w-0 flex flex-col gap-6 print:w-full print:p-0 print:m-0"
        >
          {currentStep < 7 && <div className="no-print"><TimetableHealthChecker /></div>}
          {renderStep()}

          {/* Bottom Big AI Assistant */}
          <div className="no-print">
            <AiPanel />
          </div>
        </div>
      </main>

      <footer className="max-w-[1400px] mx-auto w-full px-6 py-4 flex justify-between items-center border-t border-white/[0.06] text-slate-500 text-sm no-print">
        <span>© 2025 IBP Timetable Generator • NEP 2020 Ready</span>
        <span className="text-xs opacity-50">Constraint-aware scheduling</span>
      </footer>
    </div>
  );
}
