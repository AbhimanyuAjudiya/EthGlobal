'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import { LangSwitch, T, useLang } from '../i18n/lang';
import { plans } from '../lib/store';
import { DEMO_ROLE_INDEX, type Wallet } from '../lib/wallet';

/** "TESTNET · test USDC · not a sale" — Stripe's test-mode rail, 12 px Chivo Mono, on every money screen. */
export function TestnetStrip() {
  return (
    <p className="testnet-strip" role="note">
      <T k="testnet.strip" />
    </p>
  );
}

/** Wordmark top-left, language switch top-right. */
export function AppHeader({ right }: { right?: ReactNode }) {
  return (
    <header className="app-header">
      <Link href="/" className="wordmark" lang="en">
        Recharge
      </Link>
      <div className="app-header__right">
        {right}
        <LangSwitch />
      </div>
    </header>
  );
}

/** Four labelled tabs, shown only once a bundle exists on this device; `active` omitted on a screen none owns. */
export function TabBar({ active }: { active?: 'plan' | 'add' | 'gift' | 'receipts' }) {
  const [key, setKey] = useState<string | undefined>();
  useEffect(() => {
    void plans.latest().then(setKey);
  }, []);
  if (!key) return null;
  const k = encodeURIComponent(key);
  const tabs = [
    { id: 'plan', href: `/plan/${k}`, label: 'tab.plan' },
    { id: 'add', href: `/pay?key=${k}`, label: 'tab.add' },
    { id: 'gift', href: '/gift', label: 'tab.gift' },
    { id: 'receipts', href: `/receipts?key=${k}`, label: 'tab.receipts' },
  ] as const;
  return (
    <nav className="tab-bar" aria-label="Recharge">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          prefetch={false}
          aria-current={tab.id === active ? 'page' : undefined}
        >
          <T k={tab.label} />
        </Link>
      ))}
    </nav>
  );
}

/**
 * Page frame: one column, 16 px gutters, primary action in the bottom quarter. The TabBar is the frame's last
 * child and sticks to the bottom, so it never covers the screen's own primary action (RT design review #1).
 */
export function Screen({
  children,
  money = false,
  wide = false,
  className,
}: {
  children: ReactNode;
  money?: boolean;
  wide?: boolean;
  className?: string;
}) {
  return (
    <div className={`screen${wide ? ' screen--wide' : ''}${className ? ` ${className}` : ''}`}>
      {money ? <TestnetStrip /> : null}
      {children}
    </div>
  );
}

const demoIndex = (wallet: Wallet) =>
  Number(/#(\d+)/.exec(wallet.name)?.[1] ?? DEMO_ROLE_INDEX.human);

/** The paying account's name in the page language: "डेमो वॉलेट · Anvil #5"; an injected wallet keeps its brand. */
export function useWalletLabel(): (wallet: Wallet | undefined) => string {
  const { t } = useLang();
  return (wallet) =>
    !wallet
      ? t('pay.yourWallet')
      : wallet.kind === 'demo'
        ? t('demo.banner', { n: demoIndex(wallet) })
        : wallet.name;
}

/** MODE=local only: the visible "demo wallet · Anvil #5" banner. Compiled out of live builds. */
export function DemoWalletPanel({ wallet }: { wallet: Wallet | undefined }) {
  if (process.env.NEXT_PUBLIC_MODE !== 'local' || wallet?.kind !== 'demo') return null;
  const index = demoIndex(wallet);
  return (
    <p className="demo-wallet" role="note" data-testid="demo-wallet">
      <T k="demo.banner" params={{ n: index }} />
      <span className="demo-wallet__addr" data-hash title={wallet.address}>
        {`${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`}
      </span>
    </p>
  );
}

/** "Continue with Coinbase Wallet / MetaMask" when no wallet is connected yet. */
export function WalletButton({
  wallet,
  busy,
  error,
  onInjected,
}: {
  wallet: Wallet | undefined;
  busy: boolean;
  error: string | undefined;
  onInjected: () => void;
}) {
  if (wallet) return <DemoWalletPanel wallet={wallet} />;
  return (
    <div className="wallet-connect">
      <button
        type="button"
        className="ui-button"
        data-variant="secondary"
        onClick={onInjected}
        disabled={busy}
      >
        <T k="pay.noWallet" />
      </button>
      {error ? <p className="note">{error}</p> : null}
    </div>
  );
}
