import type { ReactNode } from 'react';

/**
 * The sticky bar above the BottomNav (surface, top hairline, 16 px pad) holding the ONE primary pill and an optional
 * quiet link under it. Inline under the last block from 1024 px. AppShell's `action` renders one; a screen may also
 * place it as its last block.
 */
export function ActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`action-bar${className ? ` ${className}` : ''}`}>{children}</div>;
}
