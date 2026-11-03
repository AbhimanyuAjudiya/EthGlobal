import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Token sheet',
  description: 'Living style sheet for the design tokens in @ethglobal/ui.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // data-type picks the type pairing (ledger | terminal | bazaar); data-theme pins light/dark when set.
  return (
    <html lang="en" data-type="ledger" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
