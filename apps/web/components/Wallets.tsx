'use client';

import '@rainbow-me/rainbowkit/styles.css';

import { lightTheme, RainbowKitProvider, type Theme } from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';

import { useLang } from '../i18n/lang';
import { makeWagmiConfig } from '../lib/wagmi';

const base = lightTheme({
  accentColor: 'var(--accent)',
  accentColorForeground: 'var(--on-accent)',
  borderRadius: 'medium',
  fontStack: 'system',
  overlayBlur: 'none',
});

/**
 * RainbowKit in our tokens. Every value is a CSS variable from packages/ui/tokens.css, and those are light-dark()
 * pairs, so the modal follows the page's theme (system, or <html data-theme>) with one theme object.
 */
export const rechargeTheme: Theme = {
  ...base,
  colors: {
    ...base.colors,
    actionButtonBorder: 'var(--border-subtle)',
    actionButtonBorderMobile: 'var(--border-subtle)',
    actionButtonSecondaryBackground: 'var(--bg-sunken)',
    closeButton: 'var(--text-secondary)',
    closeButtonBackground: 'var(--bg-sunken)',
    connectButtonBackground: 'var(--bg-surface)',
    connectButtonInnerBackground: 'var(--bg-sunken)',
    connectButtonText: 'var(--text-primary)',
    downloadBottomCardBackground: 'var(--bg-surface)',
    downloadTopCardBackground: 'var(--bg-sunken)',
    error: 'var(--negative)',
    generalBorder: 'var(--border-subtle)',
    generalBorderDim: 'var(--border-subtle)',
    menuItemBackground: 'var(--bg-sunken)',
    modalBackground: 'var(--bg-overlay)',
    modalBorder: 'var(--border-subtle)',
    modalText: 'var(--text-primary)',
    modalTextDim: 'var(--text-tertiary)',
    modalTextSecondary: 'var(--text-secondary)',
    profileAction: 'var(--bg-sunken)',
    profileActionHover: 'var(--bg-raised)',
    profileForeground: 'var(--bg-surface)',
    selectedOptionBorder: 'var(--accent)',
    standby: 'var(--warning)',
  },
  fonts: { body: 'var(--font-text)' },
  radii: {
    ...base.radii,
    actionButton: 'var(--radius-control)',
    connectButton: 'var(--radius-control)',
    menuButton: 'var(--radius-control)',
    modal: 'var(--radius-object)',
    modalMobile: 'var(--radius-object)',
  },
};

/** wagmi + react-query + RainbowKit around the app (lib/wagmi.ts has the chains, wallets and transports). */
export function Wallets({ children }: { children: ReactNode }) {
  const { lang } = useLang();
  const [wagmi] = useState(() => makeWagmiConfig());
  const [queries] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmi}>
      <QueryClientProvider client={queries}>
        {/* RainbowKit ships en and hi; Marathi readers get the Hindi modal (same script) */}
        <RainbowKitProvider theme={rechargeTheme} locale={lang === 'en' ? 'en-US' : 'hi-IN'}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
