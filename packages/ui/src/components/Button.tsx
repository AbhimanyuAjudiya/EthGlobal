import { cx } from './format';

import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = the one teal action per screen, carrying the amount ("Pay $0.40 USDC"). */
  variant?: ButtonVariant;
  /** Full width of its container (thumb-zone primary actions). */
  block?: boolean;
}

/** 48 px target, sentence-case label, press = 98 % in 80–100 ms; no spinner state by design. */
export function Button({
  variant = 'primary',
  block = false,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('ui-button', block && 'ui-button--block', className)}
      data-variant={variant}
      {...rest}
    />
  );
}
