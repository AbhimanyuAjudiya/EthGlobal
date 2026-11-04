import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import '@ethglobal/ui/print.css';

export const metadata: Metadata = {
  title: 'Print',
  robots: { index: false, follow: false },
};

/** The print route: bazaar pairing, print.css; never linked from the product (T-64). */
export default function PrintLayout({ children }: { children: ReactNode }) {
  return <div data-type="bazaar">{children}</div>;
}
