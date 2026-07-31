interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
}

export function StepIndicator({ currentStep, totalSteps }: StepIndicatorProps) {
  return (
    <div className="flex gap-2">
      {Array.from({ length: totalSteps }, (_, i) => {
        const step = i + 1;
        const isCompleted = step < currentStep;
        const isActive = step === currentStep;

        return (
          <div
            key={step}
            data-testid={`step-${step}`}
            data-active={isActive ? "true" : "false"}
            className={`h-2 flex-1 rounded-full transition-colors ${
              isCompleted ? "bg-accent" : isActive ? "bg-accent" : "bg-border"
            }`}
          />
        );
      })}
    </div>
  );
}
