'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useAccount, useDisconnect } from 'wagmi';

import { Button, Icon } from '@ethglobal/ui/components';

import { LangSwitch, T, useLang, useNetworkName } from '../i18n/lang';
import { IS_TESTNET } from '../lib/env';
import { plans } from '../lib/store';
import { caip2, demoIndex, type Wallet } from '../lib/wallet';

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

/** The open panel's tab stops, in document order (its links, buttons and the switch; none is ever disabled). */
const tabStops = (panel: HTMLElement) => [
  ...panel.querySelectorAll<HTMLElement>('a[href], button, input'),
];

const PROOF_KEY = 'recharge.proof';
const proofListeners = new Set<() => void>();
/** This tab's choice when localStorage is unavailable (private mode). */
let proofChoice: boolean | undefined;

/** "Show proof after each action": this browser's choice, else on while the chain is a testnet (judges see it). */
function readProof(): boolean {
  if (proofChoice !== undefined) return proofChoice;
  try {
    const stored = localStorage.getItem(PROOF_KEY);
    return stored === null ? IS_TESTNET : stored === 'on';
  } catch {
    return IS_TESTNET;
  }
}

function subscribeProof(listener: () => void) {
  proofListeners.add(listener);
  return () => {
    proofListeners.delete(listener);
  };
}

/** Whether the ProofPanel shows after an action (the menu's switch, per browser). */
export const useProofShown = (): boolean =>
  useSyncExternalStore(subscribeProof, readProof, () => IS_TESTNET);

/** The menu's "Show proof after each action" switch, persisted per browser (a per-viewer convenience). */
function ProofSwitch() {
  const { t, lang } = useLang();
  const on = useProofShown();
  return (
    <label className="proof-switch" lang={lang}>
      <input
        type="checkbox"
        role="switch"
        checked={on}
        onChange={(e) => {
          proofChoice = e.target.checked;
          try {
            localStorage.setItem(PROOF_KEY, proofChoice ? 'on' : 'off');
          } catch {
            // per-viewer convenience only
          }
          for (const listener of proofListeners) listener();
        }}
      />
      {t('proof.switch')}
    </label>
  );
}

/**
 * The header menu, on every screen whether or not a plan exists: a "Menu" disclosure button and a panel with every
 * destination, the "Show proof after each action" switch and, with `withLang`, the language switch (the phone header
 * has no room for it). Open, the panel holds the focus (Tab and Shift+Tab wrap inside it); Escape or Close shuts it
 * and returns the focus to the button; a tap outside shuts it. Every target is 44 px or more (RT-W-07).
 */
export function SiteMenu({ withLang = false }: { withLang?: boolean }) {
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
        <div className="site-menu__prefs">
          {withLang ? <LangSwitch /> : null}
          <ProofSwitch />
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

/**
 * One row at 360 px: wordmark · the one wallet control (icon + short address, or Connect) · Menu. From 480 px the
 * language switch joins the row; below that it lives in the menu's sheet (always there too), so nothing wraps or
 * scrolls sideways.
 */
export function AppHeader({ right }: { right?: ReactNode }) {
  return (
    <header className="app-header">
      <Link href="/" className="wordmark" lang="en">
        Recharge
      </Link>
      <div className="app-header__right">
        {right}
        <LangSwitch />
        <HeaderWallet />
        <SiteMenu withLang />
      </div>
    </header>
  );
}

/** Four labelled tabs, shown only once a bundle exists on this device; `active` omitted on a screen none owns. */
export function TabBar({
  active,
  canTopUp = true,
}: {
  active?: 'plan' | 'add' | 'gift' | 'receipts';
  canTopUp?: boolean;
}) {
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
      {tabs
        .filter((tab) => canTopUp || tab.id !== 'add')
        .map((tab) => (
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

/** What the wallet controls show of a wallet: a whole Wallet, or the header's reading of wagmi's connection. */
type WalletLabel = Pick<Wallet, 'kind' | 'name' | 'address'>;

/** The demo-wallet banner in MODE=local; nothing for an injected wallet or in a live build. */
function WalletBanner({ wallet }: { wallet: WalletLabel | undefined }) {
  if (LocalDemoPanel === null || wallet?.kind !== 'demo') return null;
  return (
    <Suspense fallback={null}>
      <LocalDemoPanel wallet={wallet} />
    </Suspense>
  );
}

/** What the connect control shows: everything it needs from RainbowKit's ConnectButton.Custom and wagmi, as plain props. */
export interface WalletControlProps {
  /** false on the server and during hydration: the control renders but does nothing yet. */
  mounted: boolean;
  /** Connected: ENS name or the shortened address (RainbowKit `displayName`); the full address in `address`. */
  account?: { address: string; displayName: string } | undefined;
  /**
   * The wallet's current chain, said neutrally: each action switches to the chain it signs on itself (useEnsureChain),
   * so no chain is "wrong" here.
   */
  network?: string | undefined;
  onConnect: () => void;
  onDisconnect: () => void;
}

/**
 * The header's wallet control, in the menu button's style (44 px targets, RT-W-07): "Connect" opens RainbowKit's modal;
 * connected, the name or shortened address opens a small panel with the wallet's network and Disconnect.
 */
export function WalletControl({
  mounted,
  account,
  network,
  onConnect,
  onDisconnect,
}: WalletControlProps) {
  const { t, lang } = useLang();
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!mounted || !account)
    return (
      <button
        type="button"
        className="menu-toggle wallet-toggle"
        onClick={onConnect}
        disabled={!mounted}
        aria-hidden={mounted ? undefined : true}
        lang={lang}
      >
        <Icon name="wallet" size={20} />
        {t('wallet.connect')}
      </button>
    );
  return (
    <div className="wallet-menu">
      <button
        type="button"
        className="menu-toggle wallet-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="wallet" size={20} />
        <span lang="en" data-hash title={account.address}>
          {account.displayName}
        </span>
      </button>
      <div
        id={id}
        className="wallet-status"
        role="group"
        aria-label={t('wallet.connected')}
        hidden={!open}
      >
        {network ? (
          <p className="wallet-status__network" lang={lang}>
            {`${t('pay.hNetwork')} · ${network}`}
          </p>
        ) : null}
        <Button variant="quiet" onClick={onDisconnect}>
          <T k="wallet.disconnect" />
        </Button>
      </div>
    </div>
  );
}

/**
 * The one wallet control, top-right on every screen (AppHeader, the sponsor console): whatever wagmi has connected. It
 * never connects a wallet itself; in MODE=local a screen that signs connects its demo role through useWallet.
 */
export function HeaderWallet() {
  const { address, connector } = useAccount();
  const demo =
    address && connector?.id.startsWith('demo-')
      ? { kind: 'demo' as const, name: connector.name, address }
      : undefined;
  return <WalletButton wallet={demo} />;
}

/** RainbowKit's ConnectButton, rendered as WalletControl; the demo wallet (MODE=local) shows its banner instead. */
export function WalletButton({ wallet }: { wallet: WalletLabel | undefined }) {
  const netName = useNetworkName();
  const { disconnect } = useDisconnect();
  if (wallet?.kind === 'demo') return <WalletBanner wallet={wallet} />;
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openConnectModal }) => (
        <WalletControl
          mounted={mounted}
          account={account}
          // the name the wallet itself shows ("Hedera Testnet"); a chain this app does not list by its CAIP name
          network={chain ? (chain.name ?? netName(caip2(chain.id))) : undefined}
          onConnect={openConnectModal}
          onDisconnect={() => disconnect()}
        />
      )}
    </ConnectButton.Custom>
  );
}
