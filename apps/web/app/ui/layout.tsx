import { notFound } from 'next/navigation';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import '@ethglobal/ui/print.css';

export const metadata: Metadata = {
  title: 'Component gallery',
  description: 'Tooling: every @ethglobal/ui component in every state, light and dark.',
  robots: { index: false, follow: false },
};

/**
 * Tooling routes (/ui, /ui/print, /ui/tokens) render in the product pairing, "bazaar", and exist only in
 * MODE=local: a live build answers 404 (RT-W-10, T-64), so the production host never serves a print-ready sheet.
 */
export default function GalleryLayout({ children }: { children: ReactNode }) {
  if (process.env.NEXT_PUBLIC_MODE !== 'local') notFound();
  return (
    <div data-type="bazaar" className="font-text">
      {children}
    </div>
  );
}
