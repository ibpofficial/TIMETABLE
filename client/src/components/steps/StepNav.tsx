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

  return (
    <div className="flex items-center justify-between mt-8 pt-5 border-t border-white/[0.06]">
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
  );
}
