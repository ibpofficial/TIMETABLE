import { useRef } from 'react';
import { useTimetableStore, type WizardStep } from '../store/useTimetableStore';
import { CheckIcon, ChevronRight } from 'lucide-react';
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

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 max-w-[1400px] mx-auto w-full px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 print:block print:p-0 print:m-0">
        {/* Sidebar — Step Navigator */}
        <aside className="lg:sticky lg:top-[80px] h-fit no-print">
          <nav aria-label="Wizard steps">
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
                    className={`
                      group relative flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer
                      border transition-all duration-200 whitespace-nowrap lg:whitespace-normal
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand
                      ${isActive
                        ? 'bg-gradient-to-r from-[#121a3a] to-[#0c1230] border-[#28305a] text-white shadow-md translate-x-0 lg:translate-x-1 font-bold'
                        : 'bg-panel/60 border-white/[0.06] text-slate-400 hover:text-white hover:lg:translate-x-1'
                      }
                    `}
                  >
                    {/* Accent bar */}
                    <span
                      className={`absolute left-0 top-0 h-full w-1 rounded-l-xl bg-gradient-to-b from-brand to-brand-light transition-opacity duration-200
                        ${isActive || isDone ? 'opacity-100' : 'opacity-0'}`}
                    />

                    {/* Step number / check */}
                    <span className={`
                      flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
                      ${isActive ? 'bg-gradient-to-br from-brand to-brand-light text-white'
                        : isDone ? 'bg-green-500/20 text-green-400'
                        : 'bg-white/[0.04] text-slate-600'}
                    `}>
                      {isDone ? <CheckIcon size={13} /> : step.id}
                    </span>

                    <span className="text-sm font-medium">{step.label}</span>

                    {isActive && <ChevronRight size={14} className="ml-auto text-brand opacity-70 hidden lg:block" />}
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
