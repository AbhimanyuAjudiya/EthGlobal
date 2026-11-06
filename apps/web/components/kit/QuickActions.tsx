import Link from 'next/link';

import { KitIcon, type KitIconName } from './icons';

export interface QuickAction {
  icon: KitIconName;
  label: string;
  href?: string;
  onClick?: () => void;
  /** The brand-filled circle (at most one). */
  primary?: boolean;
  disabled?: boolean;
  'data-testid'?: string;
}

/** A row of 3–4 round 56 px icon buttons with the label under each (Install · Add data · Gift · Receipts). */
export function QuickActions({ items, label }: { items: readonly QuickAction[]; label?: string }) {
  return (
    <ul className="quick-actions" aria-label={label}>
      {items.map((item) => {
        const inner = (
          <>
            <span className="quick-actions__icon" data-primary={item.primary ? true : undefined}>
              <KitIcon name={item.icon} size={24} />
            </span>
            <span className="quick-actions__label">{item.label}</span>
          </>
        );
        return (
          <li key={item.label}>
            {item.href && !item.disabled ? (
              <Link
                href={item.href}
                prefetch={false}
                className="quick-actions__item"
                data-testid={item['data-testid']}
              >
                {inner}
              </Link>
            ) : (
              <button
                type="button"
                className="quick-actions__item"
                onClick={item.onClick}
                disabled={item.disabled}
                data-testid={item['data-testid']}
              >
                {inner}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
