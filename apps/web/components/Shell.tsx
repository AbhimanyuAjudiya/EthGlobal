'use client';

import Link from 'next/link';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { Icon } from '@ethglobal/ui/components';

import { LangSwitch, T, useLang } from '../i18n/lang';
import { IS_TESTNET } from '../lib/env';
import { useInjectedWallets } from '../lib/hooks';
import { plans } from '../lib/store';
import { demoIndex, type Announced, type Wallet } from '../lib/wallet';

import type { StringKey } from '../i18n/strings';

/**
 * "TESTNET · test USDC · not a sale" — Stripe's test-mode rail, 12 px Chivo Mono, on every money screen and the
 * sponsor console while the configured chain is a testnet (lib/env.ts IS_TESTNET); nothing on 295/8453.
 */
export function TestnetStrip() {
  // TODO(mainnet copy, human): the mainnet rail (terms, refunds, what paying real money means) is the human's text.
  if (!IS_TESTNET) return null;
  return (
    <p className="testnet-strip" role="note">
      <T k="testnet.strip" />
    </p>
  );
}

/**
 * Every user flow, grouped. The header menu lists the titles; the landing's "Everything Recharge does" adds the
 * line under each. One list, so the two can never disagree.
 */
export const DESTINATIONS: readonly {
  group: StringKey;
  items: readonly { href: string; title: StringKey; line: StringKey }[];
}[] = [
  {
    group: 'hub.get',
    items: [
      { href: '/verify', title: 'hub.free', line: 'hub.freeLine' },
      { href: '/pay', title: 'hub.buy', line: 'hub.buyLine' },
      { href: '/card', title: 'hub.card', line: 'hub.cardLine' },
    ],
  },
  {
    group: 'hub.give',
    items: [
      { href: '/gift', title: 'hub.gift', line: 'hub.giftLine' },
      { href: '/gift/claim', title: 'gift.claimTitle', line: 'hub.claimLine' },
    ],
  },
  {
    group: 'hub.yours',
    items: [
      { href: '/plan', title: 'hub.plan', line: 'hub.planLine' },
      { href: '/agent', title: 'hub.agent', line: 'hub.agentLine' },
      { href: '/receipts', title: 'receipts.title', line: 'hub.receiptsLine' },
    ],
  },
  {
    group: 'hub.sponsors',
    items: [{ href: '/sponsor', title: 'hub.sponsor', line: 'hub.sponsorLine' }],
  },
];

/** The open panel's tab stops, in document order (its links and buttons; none is ever disabled). */
const tabStops = (panel: HTMLElement) => [
  ...panel.querySelectorAll<HTMLElement>('a[href], button'),
];

/**
 * The header menu, on every screen whether or not a plan exists: a "Menu" disclosure button and a panel with every
 * destination. Open, the panel holds the focus (Tab and Shift+Tab wrap inside it); Escape or Close shuts it and
 * returns the focus to the button; a tap outside shuts it. Every target is 44 px or more (RT-W-07).
 */
export function SiteMenu() {
  const { t, lang } = useLang();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  const shut = useCallback(() => {
    setOpen(false);
    button.current?.focus();
  }, []);

  useEffect(() => {
    const el = panel.current;
    if (!open || !el) return;
    el.querySelector<HTMLElement>('nav a')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        shut();
      } else if (e.key === 'Tab') {
        const stops = tabStops(el);
        const edge = e.shiftKey ? stops[0] : stops.at(-1);
        if (el.contains(document.activeElement) && document.activeElement !== edge) return;
        e.preventDefault();
        (e.shiftKey ? stops.at(-1) : stops[0])?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && !el.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, shut]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className="menu-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        lang={lang}
      >
        {t('menu.open')}
      </button>
      {open ? <div className="site-menu__scrim" aria-hidden="true" /> : null}
      <div
        ref={panel}
        id={id}
        className="site-menu"
        role="dialog"
        aria-modal="true"
        aria-label={t('menu.open')}
        hidden={!open}
        lang={lang}
      >
        <div className="site-menu__bar">
          <Link
            href="/"
            className="wordmark"
            lang="en"
            prefetch={false}
            onClick={() => setOpen(false)}
          >
            Recharge
          </Link>
          <button type="button" className="menu-toggle" onClick={shut}>
            <Icon name="close" size={20} />
            {t('menu.close')}
          </button>
        </div>
        <nav className="site-menu__groups" aria-label={t('hub.title')}>
          {DESTINATIONS.map((group) => (
            <div key={group.group}>
              <h2 className="site-menu__label">{t(group.group)}</h2>
              <ul>
                {group.items.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} prefetch={false} onClick={() => setOpen(false)}>
                      {t(item.title)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
    </>
  );
}

/** A plain warning where it applies: the warning triangle and one factual sentence, in the text colours. */
export function Caution({ k }: { k: StringKey }) {
  return (
    <p className="note caution">
      <Icon name="warning" />
      <T k={k} />
    </p>
  );
}

/** Wordmark top-left; language switch and the menu top-right. */
export function AppHeader({ right }: { right?: ReactNode }) {
  return (
    <header className="app-header">
      <Link href="/" className="wordmark" lang="en">
        Recharge
      </Link>
      <div className="app-header__right">
        {right}
        <LangSwitch />
        <SiteMenu />
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

/**
 * MODE=local only: the visible "demo wallet · Anvil #5" banner. The component lives in lib/local/demo-wallet-panel.tsx
 * and is imported only behind a literal `process.env.NEXT_PUBLIC_MODE === 'local'`, so a live build carries neither
 * its code nor its name nor its markup (RT-W-12, AUD-09). Live: `null`, and `WalletBanner` renders nothing.
 */
const LocalDemoPanel =
  process.env.NEXT_PUBLIC_MODE === 'local'
    ? lazy(() => import('../lib/local/demo-wallet-panel'))
    : null;

/** The demo-wallet banner in MODE=local; nothing for an injected wallet or in a live build. */
export function WalletBanner({ wallet }: { wallet: Wallet | undefined }) {
  if (LocalDemoPanel === null || wallet?.kind !== 'demo') return null;
  return (
    <Suspense fallback={null}>
      <LocalDemoPanel wallet={wallet} />
    </Suspense>
  );
}

/** A wallet's EIP-6963 icon: only the data: URI the spec requires is shown (csp.ts img-src); a URL is never fetched. */
function WalletIcon({ src }: { src: string | undefined }) {
  if (!src?.startsWith('data:image/')) return null;
  // eslint-disable-next-line @next/next/no-img-element -- a data: URI; nothing for next/image to optimise
  return <img className="wallet-picker__icon" src={src} alt="" width={20} height={20} />;
}

/**
 * The connect control while no wallet is connected: one injected wallet is named ("Continue with MetaMask"); several
 * (EIP-6963: MetaMask and Coinbase Wallet both installed) open a picker, each with its own icon and name; none keeps
 * the generic line and lets `onInjected()` fall back to window.ethereum.
 */
export function WalletButton({
  wallet,
  busy,
  error,
  onInjected,
}: {
  wallet: Wallet | undefined;
  busy: boolean;
  error: string | undefined;
  /** Connect the chosen wallet; with none chosen, whatever discovery finds. */
  onInjected: (choice?: Announced) => void;
}) {
  const { t } = useLang();
  const found = useInjectedWallets();
  const [open, setOpen] = useState(false);
  if (wallet) return <WalletBanner wallet={wallet} />;
  const only = found.length === 1 ? found[0] : undefined;
  return (
    <div className="wallet-connect">
      {open && found.length > 1 ? (
        <div className="sheet wallet-picker" role="group" aria-label={t('pay.chooseWallet')}>
          {found.map((w) => (
            <button
              key={w.info.rdns}
              type="button"
              className="ui-button ui-button--block"
              data-variant="secondary"
              onClick={() => onInjected(w)}
              disabled={busy}
            >
              <WalletIcon src={w.info.icon} />
              <span lang="en">{w.info.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          className="ui-button"
          data-variant="secondary"
          onClick={() => (found.length > 1 ? setOpen(true) : onInjected(only))}
          disabled={busy}
        >
          {found.length > 1 ? (
            <T k="pay.chooseWallet" />
          ) : only ? (
            <T k="pay.continueWith" params={{ name: only.info.name }} />
          ) : (
            <T k="pay.noWallet" />
          )}
        </button>
      )}
      {error ? <p className="note">{error}</p> : null}
    </div>
  );
}
