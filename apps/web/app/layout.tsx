import { ServiceWorker } from '../components/ServiceWorker';
import { Wallets } from '../components/Wallets';
import { LangProvider } from '../i18n/lang';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Recharge', template: '%s · Recharge' },
  description: "Prove you're one human and a sponsor pays for your first 300 MB in Mumbai.",
  applicationName: 'Recharge',
  appleWebApp: { capable: true, title: 'Recharge', statusBarStyle: 'default' },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  formatDetection: { telephone: false },
};

// Every document renders per request so it can carry the request's CSP nonce (proxy.ts, lib/csp.ts, RT-W-02).
export const dynamic = 'force-dynamic';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfaf7' },
    { media: '(prefers-color-scheme: dark)', color: '#0f0d0b' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // data-type="bazaar" is the product pairing (DECISION §8.3); theme follows the system unless data-theme is set.
  return (
    <html lang="en" data-type="bazaar" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <LangProvider>
          <Wallets>{children}</Wallets>
        </LangProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
