'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import type { PlansResponse } from '@ethglobal/protocol/schemas';

import { api, ApiError } from './api';
import { IS_LOCAL } from './env';
import { connect, connectDemo, discoverInjected, type DemoRole, type Wallet } from './wallet';

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
    if (!IS_LOCAL) return;
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

  const pickInjected = useCallback(async () => {
    setBusy(true);
    try {
      const [first] = await discoverInjected();
      if (!first) throw new Error('No browser wallet found. Install Coinbase Wallet or MetaMask.');
      setWallet(await connect(first.provider, 'injected', first.info.name));
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!IS_LOCAL) return;
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

const noopSubscribe = () => () => undefined;

/** false on the server and during hydration, true after: gates reads of navigator/window in render. */
export const useHydrated = (): boolean =>
  useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

/** A clock for countdown text that re-renders every `stepMs`. */
export function useClock(stepMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(timer);
  }, [stepMs]);
  return now;
}
