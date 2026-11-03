import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import '@ethglobal/ui/print.css';

export const metadata: Metadata = {
  title: 'Component gallery',
  description: 'Tooling: every @ethglobal/ui component in every state, light and dark.',
  robots: { index: false, follow: false },
};

/** Tooling routes (/ui, /ui/print) render in the product pairing, "bazaar". */
export default function GalleryLayout({ children }: { children: ReactNode }) {
  return (
    <div data-type="bazaar" className="font-text">
      {children}
    </div>
  );
}
