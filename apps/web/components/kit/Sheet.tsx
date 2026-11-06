'use client';

import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';

import { KitIcon } from './icons';
import { useLang } from '../../i18n/lang';

/** The open panel's tab stops, in document order. */
const tabStops = (panel: HTMLElement) => [
  ...panel.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
  ),
];

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** The dialog's name and visible heading. */
  title: string;
  children: ReactNode;
  /** Where the focus goes back on close (the control that opened it); default: what had it on open. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** A selector inside the sheet that takes the focus on open; default: the first tab stop. */
  initialFocus?: string;
  /** Hide the visible heading (the dialog keeps its name). */
  hideTitle?: boolean;
  /** Close button text; default the shell's "Close". */
  closeLabel?: string;
  id?: string;
  lang?: string;
  className?: string;
}

/**
 * Bottom sheet on phones (grab handle, 28 px top radius, scrim), a centred dialog from 1024 px. Open, it holds the
 * focus (Tab / Shift+Tab wrap), Escape or Close or a scrim tap shuts it and the focus returns. Stays mounted while
 * closed (`hidden`) so CSS can run the 220 ms exit.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  returnFocusRef,
  initialFocus,
  hideTitle = false,
  closeLabel,
  id,
  lang,
  className,
}: SheetProps) {
  const { t, lang: pageLang } = useLang();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  const headingId = useId();

  useEffect(() => {
    const el = panel.current;
    if (!open || !el) return;
    opener.current = document.activeElement as HTMLElement | null;
    const returnTo = returnFocusRef?.current;
    const first =
      (initialFocus ? el.querySelector<HTMLElement>(initialFocus) : null) ?? tabStops(el)[0];
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close.current();
      } else if (e.key === 'Tab') {
        const stops = tabStops(el);
        const edge = e.shiftKey ? stops[0] : stops.at(-1);
        if (el.contains(document.activeElement) && document.activeElement !== edge) return;
        e.preventDefault();
        (e.shiftKey ? stops.at(-1) : stops[0])?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const back = returnTo ?? opener.current;
      if (back && back !== document.body) back.focus();
    };
  }, [open, initialFocus, returnFocusRef]);

  return (
    <>
      {open ? <div className="sheet-scrim" aria-hidden="true" onClick={onClose} /> : null}
      <div
        ref={panel}
        id={id}
        className={`sheet-panel${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={hideTitle ? title : undefined}
        aria-labelledby={hideTitle ? undefined : headingId}
        hidden={!open}
        lang={lang ?? pageLang}
      >
        <div className="sheet-panel__handle" aria-hidden="true" />
        <div className="sheet-panel__bar">
          {hideTitle ? null : (
            <h2 id={headingId} className="sheet-panel__title t-heading">
              {title}
            </h2>
          )}
          <button type="button" className="sheet-panel__close" onClick={onClose}>
            <KitIcon name="close" />
            <span>{closeLabel ?? t('menu.close')}</span>
          </button>
        </div>
        <div className="sheet-panel__body">{children}</div>
      </div>
    </>
  );
}
