'use client';

import { useId, type ReactNode } from 'react';

export interface ChoiceOption<V extends string = string> {
  value: V;
  label: ReactNode;
  /** A second line: the price, the balance. */
  sub?: ReactNode;
  disabled?: boolean;
}

export interface ChoiceChipsProps<V extends string = string> {
  options: readonly ChoiceOption<V>[];
  value: V | undefined;
  onChange: (value: V) => void;
  /** The group's accessible name ("Daily cap", "Size"). */
  label: string;
  /** Show `label` as a visible caption above the chips. */
  showLabel?: boolean;
  name?: string;
  className?: string;
  'data-testid'?: string;
}

/**
 * Wrapping pill chips over native radios (arrow keys, one tab stop): selected = brand fill, on-brand text. Replaces
 * the segmented control; also the amount and network pickers.
 */
export function ChoiceChips<V extends string = string>({
  options,
  value,
  onChange,
  label,
  showLabel = false,
  name,
  className,
  'data-testid': testId,
}: ChoiceChipsProps<V>) {
  const generated = useId();
  const group = name ?? generated;
  return (
    <fieldset className={`chips${className ? ` ${className}` : ''}`} data-testid={testId}>
      <legend className={showLabel ? 'chips__legend t-label' : 'ui-visually-hidden'}>
        {label}
      </legend>
      <div className="chips__row">
        {options.map((option) => (
          <label
            key={option.value}
            className="chip"
            data-selected={option.value === value || undefined}
            data-disabled={option.disabled ? true : undefined}
          >
            <input
              type="radio"
              className="ui-visually-hidden"
              name={group}
              value={option.value}
              checked={option.value === value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
            />
            <span className="chip__label">{option.label}</span>
            {option.sub ? <span className="chip__sub">{option.sub}</span> : null}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
