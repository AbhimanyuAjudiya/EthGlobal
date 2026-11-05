'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import type { PlansResponse } from '@ethglobal/protocol/schemas';

import { api, ApiError } from './api';
import {
  connect,
  connectDemo,
  discoverInjected,
  rememberedInjected,
  rememberInjected,
  watchInjected,
  type Announced,
  type DemoRole,
  type Wallet,
} from './wallet';

let plansCache: Promise<PlansResponse> | undefined;

/** GET /plans once per page load (the API caches 60 s); `error` set when the API is degraded or down. */
export function usePlans() {
  const [plans, setPlans] = useState<PlansResponse | undefined>();
  const [error, setError] = useState<ApiError | undefined>();
  useEffect(() => {
    let alive = true;
    plansCache ??= api.plans();
    plansCache.then(
      (p) => alive && setPlans(p),
      (e: unknown) => {
        plansCache = undefined;
        if (alive) setError(e instanceof ApiError ? e : new ApiError(0, 'network', String(e)));
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return { plans, error, loading: !plans && !error };
}

/**
 * The paying wallet. MODE=local connects the labelled demo wallet for `role` by default (the e2e path);
 * an injected EIP-1193 wallet can always be chosen instead.
 */
export function useWallet(role: DemoRole = 'human') {
  const [wallet, setWallet] = useState<Wallet | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

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
      setWallet(await connect(target.provider, 'injected', target.info.name));
      rememberInjected(target.info.rdns);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

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

  return { wallet, error, busy, pickDemo, pickInjected };
}

/**
 * The injected wallets announced so far (EIP-6963, late announcers included), for the connect button — narrowed to
 * the one chosen earlier in this tab, so the next screen offers it by name. Empty on the server and until the
 * first announcement; window.ethereum is not listed (it is `pickInjected()`'s fallback, not a named wallet).
 */
export function useInjectedWallets(): Announced[] {
  const [found, setFound] = useState<Announced[]>([]);
  useEffect(() => watchInjected(setFound), []);
  return useMemo(() => {
    const rdns = rememberedInjected();
    const chosen = found.find((w) => w.info.rdns === rdns);
    return chosen ? [chosen] : found;
  }, [found]);
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
