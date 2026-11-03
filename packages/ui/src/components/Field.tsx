'use client';

import { useId, type InputHTMLAttributes } from 'react';

import { cx } from './format';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'children'> {
  label: string;
  /** One line under the input: the format or the rule ("16 digits, on the back of the card"). */
  hint?: string;
  /** Plain-words error; neutral ink, because red is reserved for money that failed to move. */
  error?: string;
  /** Chivo Mono with slashed zero: PINs, ENS names, activation codes. */
  mono?: boolean;
  id?: string;
}

export function Field({ label, hint, error, mono = false, id, className, ...input }: FieldProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cx('ui-field', className)} data-invalid={error ? true : undefined}>
      <label className="ui-field__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className={cx('ui-field__input', mono && 'ui-field__input--mono')}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...input}
      />
      {hint ? (
        <p id={hintId} className="ui-field__hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="ui-field__error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
