import type { HTMLAttributes, ReactNode } from 'react';

export type CardTone = 'surface' | 'band' | 'brand-pale';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  tone?: CardTone;
  /** 20 px padding (24 px from 600 px); false for a card that holds a ListGroup edge to edge. */
  padded?: boolean;
  /** The element: a plain div, a section (give it aria-labelledby) or an article. */
  as?: 'div' | 'section' | 'article';
  children: ReactNode;
}

/** 24 px radius; no border on the canvas, a hairline when it sits on a surface. */
export function Card({
  tone = 'surface',
  padded = true,
  as: Tag = 'div',
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <Tag
      className={`card${padded ? ' card--padded' : ''}${className ? ` ${className}` : ''}`}
      data-tone={tone}
      {...rest}
    >
      {children}
    </Tag>
  );
}
