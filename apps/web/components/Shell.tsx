'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useAccount, useDisconnect } from 'wagmi';

import { Button, Icon } from '@ethglobal/ui/components';

import { KitIcon, type KitIconName } from './kit/icons';
import { Sheet } from './kit/Sheet';
import { T, useLang, useNetworkName } from '../i18n/lang';
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
    group: 'hub.sponsors',
    items: [{ href: '/sponsor', title: 'hub.sponsor', line: 'hub.sponsorLine' }],
  },
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

/** The four tab roots of the BottomNav; everything else in DESTINATIONS lives in More. */
const TAB_HREFS = new Set(['/', '/plan', '/pay', '/gift']);

/**
 * A menu button and its Sheet: every destination of `filter` and the proof switch (no language switch: the owner
 * dropped it from the UI; `?lang=` and the LangProvider still work). Open, the sheet holds the focus (Tab and Shift+Tab wrap inside it); Escape or Close shuts it and returns the
 * focus to the button; a tap on the scrim shuts it. Every target is 44 px or more (RT-W-07).
 */
function MenuSheet({
  label,
  filter,
  className,
  icon,
}: {
  label: string;
  filter?: (href: string) => boolean;
  className: string;
  icon?: KitIconName;
}) {
  const { t, lang } = useLang();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const shut = useCallback(() => setOpen(false), []);
  const groups = DESTINATIONS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !filter || filter(item.href)),
  })).filter((group) => group.items.length > 0);
  return (
    <>
      <button
        ref={button}
        type="button"
        className={className}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        lang={lang}
      >
        {icon ? <KitIcon name={icon} size={24} /> : null}
        <span>{label}</span>
      </button>
      <Sheet
        open={open}
        onClose={shut}
        title={label}
        id={id}
        className="site-menu"
        returnFocusRef={button}
        initialFocus="nav a"
      >
        <div className="site-menu__prefs">
          <ProofSwitch />
        </div>
        <nav className="site-menu__groups" aria-label={t('hub.title')}>
          {groups.map((group) => (
            <div key={group.group}>
              <h3 className="site-menu__label t-caption">{t(group.group)}</h3>
              <ul className="list-group">
                {group.items.map((item) => (
                  <li key={item.href} className="list-row">
                    <Link
                      href={item.href}
                      prefetch={false}
                      className="list-row__main"
                      onClick={shut}
                    >
                      <span className="list-row__text">
                        <span className="list-row__title">{t(item.title)}</span>
                      </span>
                      <KitIcon name="chevron" className="kit-icon list-row__chevron" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </Sheet>
    </>
  );
}

/**
 * The TopBar's Menu, on every screen whether or not a plan exists: a "Menu" button and a Sheet with every
 * destination and the "Show proof after each action" switch.
 */
export function SiteMenu() {
  const { t } = useLang();
  return <MenuSheet label={t('menu.open')} className="menu-toggle" />;
}

/** A plain warning where it applies: the warning triangle and one factual sentence, on a warning tint. */
export function Caution({ k }: { k: StringKey }) {
  return (
    <p className="note caution">
      <Icon name="warning" />
      <T k={k} />
    </p>
  );
}

/** Inside an AppShell the legacy Screen / AppHeader / TabBar step aside: the shell already draws the chrome. */
const ShellContext = createContext(false);

export type ShellNav = 'home' | 'plan' | 'add' | 'gift' | 'more';

/** DESIGN.md §7: the tab a path belongs to and, on a sub-screen, where Back goes. */
export function routeChrome(path: string | null): { nav?: ShellNav; back?: string } {
  if (path === null) return {};
  const p = path;
  if (p === '/') return { nav: 'home' };
  if (p === '/plan' || p.startsWith('/plan/')) return { nav: 'plan' };
  if (p === '/pay') return { nav: 'add' };
  if (p === '/gift') return { nav: 'gift' };
  if (p === '/gift/claim') return { nav: 'gift', back: '/gift' };
  if (p.startsWith('/card/')) return { nav: 'more', back: '/card' };
  if (p === '/receipts' || p === '/install')
    return { nav: p === '/install' ? 'plan' : 'more', back: '/plan' };
  if (p === '/card' || p === '/agent') return { nav: 'more', back: '/' };
  return { back: '/' };
}

const noSubscribe = () => () => undefined;
/**
 * The address bar's path, after hydration (null on the server): only for screens that do not say their own tab /
 * Back. Read from window so a screen renders outside the App Router (unit tests) too.
 */
const useAddressPath = (): string | null =>
  useSyncExternalStore(
    noSubscribe,
    () => window.location.pathname,
    () => null,
  );

/**
 * TopBar, 48 px: Back (sub-screens) or the wordmark (tab roots) left; the wallet pill and Menu right. From 1024 px it
 * heads the content column and the wordmark moves to the sidebar.
 */
function TopBar({ back, title }: { back?: string | undefined; title?: string | undefined }) {
  const { t, lang } = useLang();
  return (
    <header className="app-header topbar">
      <div className="topbar__left">
        {back ? (
          <Link href={back} className="topbar__back" prefetch={false} lang={lang}>
            <KitIcon name="back" size={24} />
            <span className="ui-visually-hidden">{t('nav.back')}</span>
          </Link>
        ) : (
          <Link href="/" className="wordmark" lang="en">
            Recharge
          </Link>
        )}
        {title ? <span className="topbar__title t-label">{title}</span> : null}
      </div>
      <div className="app-header__right">
        <HeaderWallet />
        <SiteMenu />
      </div>
    </header>
  );
}

/**
 * Legacy header. Inside an AppShell it renders nothing (the shell's TopBar is the header); on its own (old pages,
 * tests) it is the TopBar. `right` is kept for old callers and sits before the wallet.
 */
export function AppHeader({ right }: { right?: ReactNode }) {
  const inShell = useContext(ShellContext);
  if (inShell) return null;
  return (
    <>
      <TopBar />
      {right}
    </>
  );
}

/** The current plan's key (the tabs act on it), re-read when a claim or "Make current" changes it. */
function useLatestPlan(): string | undefined {
  const [key, setKey] = useState<string | undefined>();
  useEffect(() => {
    const read = () => void plans.latest().then(setKey);
    read();
    return plans.subscribe(read);
  }, []);
  return key;
}

/** The four tabs (BottomNav and sidebar): Plan and Add point at this device's current plan when there is one. */
function useTabs() {
  const { t } = useLang();
  const key = useLatestPlan();
  const k = key ? encodeURIComponent(key) : undefined;
  return [
    { id: 'home', href: '/', icon: 'home', label: t('nav.home') },
    { id: 'plan', href: k ? `/plan/${k}` : '/plan', icon: 'plan', label: t('tab.plan') },
    { id: 'add', href: k ? `/pay?key=${k}` : '/pay', icon: 'add', label: t('tab.add') },
    { id: 'gift', href: '/gift', icon: 'gift', label: t('tab.gift') },
  ] as const;
}

/**
 * BottomNav, 56 px + safe area, on every consumer screen below 1024 px: Home · Plan · Add · Gift · More (a Sheet with
 * the other destinations and the proof switch). From 1024 px it is display: none and the Sidebar takes over.
 */
export function BottomNav({ active }: { active?: ShellNav | undefined }) {
  const { t, lang } = useLang();
  const tabs = useTabs();
  return (
    <nav className="bottom-nav tab-bar" aria-label="Recharge" lang={lang}>
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          prefetch={false}
          className="bottom-nav__item"
          aria-current={tab.id === active ? 'page' : undefined}
        >
          <KitIcon name={tab.icon} size={24} />
          <span>{tab.label}</span>
        </Link>
      ))}
      <span className="bottom-nav__more" data-active={active === 'more' || undefined}>
        <MenuSheet
          label={t('nav.more')}
          filter={(href) => !TAB_HREFS.has(href)}
          className="bottom-nav__item"
          icon="more"
        />
      </span>
    </nav>
  );
}

/** The More sheet's destinations as plain sidebar items (laptop). */
const SIDEBAR_MORE: readonly { href: string; icon: KitIconName; label: StringKey }[] = [
  { href: '/receipts', icon: 'receipt', label: 'receipts.title' },
  { href: '/card', icon: 'card', label: 'home.qa.card' },
  { href: '/agent', icon: 'agent', label: 'agent.autoTitle' },
  { href: '/sponsor', icon: 'organizers', label: 'home.qa.organizers' },
];

/**
 * The laptop sidebar (from 1024 px; display: none below, so the phone is unchanged): the wordmark, the four tabs, the
 * More destinations as plain items, and the proof switch at the bottom. Same link look as the ConsoleShell's.
 */
function Sidebar({ active, path }: { active?: ShellNav | undefined; path: string | null }) {
  const { t, lang } = useLang();
  const tabs = useTabs();
  const items = [
    ...tabs.map((tab) => ({ ...tab, current: tab.id === active })),
    ...SIDEBAR_MORE.map((item) => ({
      id: item.href,
      href: item.href,
      icon: item.icon,
      label: t(item.label),
      current: path !== null && (path === item.href || path.startsWith(`${item.href}/`)),
    })),
  ];
  return (
    <aside className="app-sidebar" lang={lang}>
      <Link href="/" className="wordmark" lang="en">
        Recharge
      </Link>
      <nav className="app-sidebar__nav" aria-label={t('hub.title')}>
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            prefetch={false}
            className="console-shell__link app-sidebar__link"
            aria-current={item.current ? 'page' : undefined}
          >
            <KitIcon name={item.icon} size={24} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
      <div className="app-sidebar__prefs">
        <ProofSwitch />
      </div>
    </aside>
  );
}

/** Legacy tab bar: inside an AppShell nothing (the shell's BottomNav); on its own, the BottomNav. */
export function TabBar({
  active,
}: {
  active?: 'plan' | 'add' | 'gift' | 'receipts';
  canTopUp?: boolean;
}) {
  const inShell = useContext(ShellContext);
  if (inShell) return null;
  return <BottomNav active={active === 'receipts' ? 'more' : active} />;
}

export interface AppShellProps {
  /** Sub-screens: where the TopBar's Back goes. Omitted: from the path (DESIGN.md §7). */
  back?: string;
  /** A short label beside Back on sub-screens. */
  title?: string;
  /** The BottomNav tab that is current. Omitted: from the path. */
  nav?: ShellNav;
  /** The ONE primary pill (and an optional quiet link), in the sticky ActionBar. */
  action?: ReactNode;
  /** Money screens: the TESTNET rail under the TopBar. */
  money?: boolean;
  /** Hide the BottomNav and the sidebar (print-like or embedded views). */
  bare?: boolean;
  /**
   * The column from 1024 px (DESIGN.md §4): `single` 40 rem (forms, sheets), `wide` 48 rem (lists), `split` 72 rem
   * for a PageSplit screen. Phones ignore it.
   */
  layout?: 'split' | 'single' | 'wide';
  children: ReactNode;
  className?: string;
}

/**
 * The one page template (DESIGN.md §4): TopBar · Page (30 rem column, 36 rem from 600 px, 20 px gutters) · ActionBar ·
 * BottomNav. From 1024 px: a 240 px sidebar and the content column (TopBar, then the `layout` column); no BottomNav.
 */
export function AppShell({
  back,
  title,
  nav,
  action,
  money = false,
  bare = false,
  layout = 'single',
  children,
  className,
}: AppShellProps) {
  const inShell = useContext(ShellContext);
  const path = useAddressPath();
  if (inShell) return <>{children}</>;
  const chrome = nav === undefined && back === undefined ? routeChrome(path) : { nav, back };
  return (
    <ShellContext.Provider value={true}>
      <div className={`app-shell${bare ? ' app-shell--bare' : ''}`}>
        {bare ? null : <Sidebar active={chrome.nav} path={path} />}
        <TopBar back={chrome.back} title={title} />
        {money ? <TestnetStrip /> : null}
        <main className={`page${className ? ` ${className}` : ''}`} data-layout={layout}>
          {children}
          {action ? <div className="action-bar">{action}</div> : null}
        </main>
        {bare ? null : <BottomNav active={chrome.nav} />}
      </div>
    </ShellContext.Provider>
  );
}

/**
 * Legacy page frame. Inside an AppShell: the screen's own column (the TESTNET rail first on money screens); on its
 * own: an AppShell with the chrome read from the path, so old pages already render inside the new template.
 */
export function Screen({
  children,
  money = false,
  className,
}: {
  children: ReactNode;
  money?: boolean;
  wide?: boolean;
  className?: string;
}) {
  const inShell = useContext(ShellContext);
  const body = (
    <div className={`screen${className ? ` ${className}` : ''}`}>
      {money && inShell ? <TestnetStrip /> : null}
      {children}
    </div>
  );
  return inShell ? body : <AppShell money={money}>{body}</AppShell>;
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
