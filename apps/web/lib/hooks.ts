'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import type { PlansResponse } from '@ethglobal/protocol/schemas';

import { api, ApiError } from './api';
import {
  connect,
  connectDemo,
  discoverInjected,
  forgetInjected,
  rememberedInjected,
  rememberInjected,
  walletFor,
  watchInjected,
  type Announced,
  type DemoRole,
  type Eip1193,
  type Wallet,
} from './wallet';

import type { Address } from 'viem';

/** One GET /plans in flight at a time: screens mounting together share it, and it is dropped once it settles. */
let inflight: Promise<PlansResponse> | undefined;
const fetchPlans = (): Promise<PlansResponse> =>
  (inflight ??= api.plans().finally(() => {
    inflight = undefined;
  }));

/** After a failed GET /plans the next try waits 5 s, then 15 s, then 60 s between tries. */
const RETRY_MS = [5_000, 15_000, 60_000] as const;

/**
 * GET /plans on every mount (never a reading kept from earlier in the session; the API caches 60 s) and again when
 * the page comes back (tab shown, back/forward cache, browser online) or a failed try's retry fires, so a screen
 * opened during an outage or an API restart recovers by itself. `plans` and `at` are the last success and when it
 * arrived; `error` is the latest try's failure (`code: 'network'` when no answer came back), cleared by a success.
 */
export function usePlans() {
  const [state, setState] = useState<{ plans?: PlansResponse; at?: number; error?: ApiError }>({});
  useEffect(() => {
    let alive = true;
    let failures = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      clearTimeout(retry);
      fetchPlans().then(
        (plans) => {
          if (!alive) return;
          failures = 0;
          setState({ plans, at: Date.now() });
        },
        (e: unknown) => {
          if (!alive) return;
          const error = e instanceof ApiError ? e : new ApiError(0, 'network', String(e));
          setState((s) => ({ ...s, error }));
          retry = setTimeout(load, RETRY_MS[Math.min(failures++, RETRY_MS.length - 1)]);
        },
      );
    };
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) load();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    load();
    window.addEventListener('online', load);
    window.addEventListener('pageshow', onShow);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearTimeout(retry);
      window.removeEventListener('online', load);
      window.removeEventListener('pageshow', onShow);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return { ...state, loading: !state.plans && !state.error };
}

/**
 * The paying wallet. MODE=local connects the labelled demo wallet for `role` by default (the e2e path);
 * an injected EIP-1193 wallet can always be chosen instead.
 */
export function useWallet(role: DemoRole = 'human') {
  const [wallet, setWallet] = useState<Wallet | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  /** The injected provider behind `wallet`, for its EIP-1193 events. */
  const provider = useRef<Eip1193 | undefined>(undefined);
  /** Set by Switch wallet: the next connect opens the wallet's own account picker. */
  const reselect = useRef(false);

  const pickDemo = useCallback(async () => {
    if (process.env.NEXT_PUBLIC_MODE !== 'local') return;
    setBusy(true);
    try {
      setWallet(await connectDemo(role));
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [role]);

  /** Connect `choice`; without one, whatever discovery finds — the wallet chosen earlier in this tab first. */
  const pickInjected = useCallback(async (choice?: Announced) => {
    setBusy(true);
    try {
      const found = choice ? [choice] : await discoverInjected();
      const chosen = rememberedInjected();
      const target = found.find((w) => w.info.rdns === chosen) ?? found[0];
      if (!target) throw new Error('No browser wallet found. Install Coinbase Wallet or MetaMask.');
      setWallet(await connect(target.provider, 'injected', target.info.name, reselect.current));
      provider.current = target.provider;
      reselect.current = false;
      rememberInjected(target.info.rdns);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  /** Drop the client and the remembered choice; `switching` makes the next connect re-ask for the account. */
  const disconnect = useCallback((switching = false) => {
    forgetInjected();
    provider.current = undefined;
    reselect.current = switching;
    setWallet(undefined);
    setError(undefined);
  }, []);

  // The wallet's own changes: another account (none = disconnected) or another chain.
  useEffect(() => {
    const p = wallet?.kind === 'injected' ? provider.current : undefined;
    if (!wallet || !p?.on) return;
    const { name, address, chainId } = wallet;
    const onAccounts = (accounts: unknown) => {
      const next = (accounts as Address[] | undefined)?.[0];
      if (next) setWallet(walletFor(p, 'injected', name, next, chainId));
      else disconnect();
    };
    const onChain = (id: unknown) => setWallet(walletFor(p, 'injected', name, address, Number(id)));
    p.on('accountsChanged', onAccounts);
    p.on('chainChanged', onChain);
    return () => {
      p.removeListener?.('accountsChanged', onAccounts);
      p.removeListener?.('chainChanged', onChain);
    };
  }, [wallet, disconnect]);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_MODE !== 'local') return;
    let alive = true;
    connectDemo(role).then(
      (w) => alive && setWallet(w),
      (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
    };
  }, [role]);

  return { wallet, error, busy, pickDemo, pickInjected, disconnect };
}

/**
 * The injected wallets announced so far (EIP-6963, late announcers included), for the connect button — narrowed to
 * the one chosen earlier in this tab, so the next screen offers it by name. Empty on the server and until the
 * first announcement; window.ethereum is not listed (it is `pickInjected()`'s fallback, not a named wallet).
 */
export function useInjectedWallets(): Announced[] {
  const [found, setFound] = useState<Announced[]>([]);
  useEffect(() => watchInjected(setFound), []);
  // Read on every render, not memoised: Switch wallet / Disconnect clear the choice without a new announcement.
  const rdns = rememberedInjected();
  const chosen = found.find((w) => w.info.rdns === rdns);
  return chosen ? [chosen] : found;
}

const noopSubscribe = () => () => undefined;

/** false on the server and during hydration, true after: gates reads of navigator/window in render. */
export const useHydrated = (): boolean =>
  useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

const tickers = new Map<
  number,
  { listeners: Set<() => void>; timer?: ReturnType<typeof setInterval> | undefined }
>();

function subscribeTick(stepMs: number) {
  return (listener: () => void) => {
    let entry = tickers.get(stepMs);
    if (!entry) {
      entry = { listeners: new Set() };
      tickers.set(stepMs, entry);
    }
    const e = entry;
    e.listeners.add(listener);
    e.timer ??= setInterval(() => {
      for (const l of e.listeners) l();
    }, stepMs);
    return () => {
      e.listeners.delete(listener);
      if (e.listeners.size === 0 && e.timer) {
        clearInterval(e.timer);
        e.timer = undefined;
      }
    };
  };
}

/**
 * The wall clock as an external store, quantised to `stepMs` so the snapshot is stable between ticks. The server
 * (and the prerendered static shell) sees 0 — time is never baked into the shell (cacheComponents).
 */
export function useClock(stepMs = 1000, active = true): number {
  const subscribe = useMemo(
    () => (active ? subscribeTick(stepMs) : noopSubscribe),
    [stepMs, active],
  );
  return useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / stepMs) * stepMs,
    () => 0,
  );
}
