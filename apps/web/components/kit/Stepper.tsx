export interface StepperProps {
  steps: readonly string[];
  /** 1-based: the step this screen is. */
  current: number;
  /** The list's accessible name ("Steps"). */
  label?: string;
  lang?: string;
}

/** Numbered dots joined by a rule; done = ink check, current = brand. */
export function Stepper({ steps, current, label, lang }: StepperProps) {
  return (
    <ol className="stepper" aria-label={label} lang={lang}>
      {steps.map((step, i) => {
        const n = i + 1;
        const state = n < current ? 'done' : n === current ? 'current' : 'next';
        return (
          <li
            key={step}
            className="stepper__step"
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="stepper__dot" aria-hidden="true">
              {n}
            </span>
            <span className="stepper__label">{step}</span>
          </li>
        );
      })}
    </ol>
  );
}
