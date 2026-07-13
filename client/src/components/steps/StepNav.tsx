import { useTimetableStore } from '../../store/useTimetableStore';
import { Button } from '../ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { WizardStep } from '../../store/useTimetableStore';

interface StepNavProps {
  onNext?: () => boolean | void;
  onPrev?: () => void;
  nextLabel?: string;
  prevLabel?: string;
  hideNext?: boolean;
  hidePrev?: boolean;
}

export function StepNav({
  onNext,
  onPrev,
  nextLabel = 'Next',
  prevLabel = 'Back',
  hideNext = false,
  hidePrev = false,
}: StepNavProps) {
  const { currentStep, setStep } = useTimetableStore();

  const handleNext = () => {
    if (onNext) {
      const result = onNext();
      if (result === false) return;
    }
    if (currentStep < 7) setStep((currentStep + 1) as WizardStep);
  };

  const handlePrev = () => {
    if (onPrev) onPrev();
    if (currentStep > 1) setStep((currentStep - 1) as WizardStep);
  };

  const progressPercent = Math.round((currentStep / 7) * 100);

  return (
    <div className="flex flex-col gap-4 mt-8 pt-5 border-t border-white/[0.06]">
      {/* Horizontal step progress tracker bar */}
      <div className="flex justify-between items-center text-[10px] font-bold font-mono tracking-widest text-slate-500 uppercase">
        <span>Wizard Progress</span>
        <span className="text-brand-light font-black">{progressPercent}%</span>
      </div>
      <div className="w-full bg-slate-950/40 border border-white/5 rounded-full h-1.5 overflow-hidden p-0">
        <div
          className="bg-gradient-to-r from-brand to-brand-light h-full rounded-full transition-all duration-500 ease-out shadow-inner"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <div className="flex items-center justify-between mt-1">
        {!hidePrev && currentStep > 1 ? (
          <Button
            id="btn-prev-step"
            variant="ghost"
            icon={<ChevronLeft size={16} />}
            onClick={handlePrev}
          >
            {prevLabel}
          </Button>
        ) : (
          <div />
        )}

        {!hideNext && currentStep < 7 && (
          <Button
            id="btn-next-step"
            variant="primary"
            onClick={handleNext}
          >
            {nextLabel}
            <ChevronRight size={16} />
          </Button>
        )}
      </div>
    </div>
  );
}
