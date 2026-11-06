import Link from 'next/link';
import { useId, type ReactNode } from 'react';

export interface SectionProps {
  title?: ReactNode;
  /** A link at the right of the heading ("See all"). */
  action?: { label: string; href: string };
  children: ReactNode;
  id?: string;
  className?: string;
  lang?: string;
}

/** Heading row + children, 40 px above; a named region when it has a title. */
export function Section({ title, action, children, id, className, lang }: SectionProps) {
  const headingId = useId();
  return (
    <section
      id={id}
      className={`section${className ? ` ${className}` : ''}`}
      aria-labelledby={title ? headingId : undefined}
      lang={lang}
    >
      {title || action ? (
        <div className="section__head">
          {title ? (
            <h2 id={headingId} className="section__title t-heading">
              {title}
            </h2>
          ) : null}
          {action ? (
            <Link href={action.href} className="section__action t-label" prefetch={false}>
              {action.label}
            </Link>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
