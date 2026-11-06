import Link from 'next/link';

import type { ButtonSize, ButtonVariant } from '@ethglobal/ui/components';

import type { MouseEventHandler, ReactNode } from 'react';

export {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from '@ethglobal/ui/components';

export interface ButtonLinkProps {
  href: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  target?: string;
  rel?: string;
  download?: string | boolean;
  id?: string;
  lang?: string;
  title?: string;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'data-testid'?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  /** A plain <a> (a universal link, a download) instead of next/link. */
  native?: boolean;
  children: ReactNode;
}

/** A link that looks like the Button pill: the primary action that navigates ("Prove I'm human → 1 GB"). */
export function ButtonLink({
  href,
  variant = 'primary',
  size = 'md',
  block = false,
  native = false,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  const cls = `ui-button${block ? ' ui-button--block' : ''}${className ? ` ${className}` : ''}`;
  return native ? (
    <a href={href} className={cls} data-variant={variant} data-size={size} {...rest}>
      {children}
    </a>
  ) : (
    <Link
      href={href}
      prefetch={false}
      className={cls}
      data-variant={variant}
      data-size={size}
      {...rest}
    >
      {children}
    </Link>
  );
}
