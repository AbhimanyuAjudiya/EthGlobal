import { cx } from './format';

import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet';
export type ButtonSize = 'lg' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = the one brand pill per screen, carrying the amount ("Pay $0.40 USDC"). */
  variant?: ButtonVariant;
  /** lg = 56 px (the ActionBar pill), md = 48 px (default, inside cards). */
  size?: ButtonSize;
  /** Full width of its container (thumb-zone primary actions). */
  block?: boolean;
}

/** A pill: primary = brand fill, secondary = sunken fill, quiet = text only; press = scale(.97). */
export function Button({
  variant = 'primary',
  size = 'md',
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
      data-size={size}
      {...rest}
    />
  );
}
