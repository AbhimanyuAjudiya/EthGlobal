'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAccount, useConnect, useWalletClient } from 'wagmi';

import type { PlansResponse } from '@ethglobal/protocol/schemas';

import { api, ApiError } from './api';
import { demoConnectorId } from './wagmi';
import { walletFor, type DemoRole, type Wallet } from './wallet';

/**
 * One GET /plans per campaign in flight at a time ('' = the default campaign): screens mounting together share it,
 * and it is dropped once it settles.
 */
const inflight = new Map<string, Promise<PlansResponse>>();
const fetchPlans = (campaignId = ''): Promise<PlansResponse> => {
  let p = inflight.get(campaignId);
  if (!p) {
    p = api.plans(campaignId || undefined).finally(() => inflight.delete(campaignId));
    inflight.set(campaignId, p);
  }
  return p;
};

/** After a failed GET /plans the next try waits 5 s, then 15 s, then 60 s between tries. */
const RETRY_MS = [5_000, 15_000, 60_000] as const;

/**
 * GET /plans on every mount (never a reading kept from earlier in the session; the API caches 60 s) and again when
 * the page comes back (tab shown, back/forward cache, browser online) or a failed try's retry fires, so a screen
 * opened during an outage or an API restart recovers by itself. `plans` and `at` are the last success and when it
 * arrived; `error` is the latest try's failure (`code: 'network'` when no answer came back), cleared by a success.
 */
export function usePlans(campaignId?: string) {
  const [state, setState] = useState<{ plans?: PlansResponse; at?: number; error?: ApiError }>({});
  useEffect(() => {
    let alive = true;
    let failures = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      clearTimeout(retry);
      fetchPlans(campaignId).then(
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
  }, [campaignId]);
  return { ...state, loading: !state.plans && !state.error };
}

/**
 * The paying wallet: the account RainbowKit connected, as a Wallet over wagmi's wallet client. MODE=local connects
 * the labelled demo wallet for `role` once per mount unless a real wallet is connected (the e2e path); any wallet can
 * still be chosen from the connect button.
 */
export function useWallet(role: DemoRole = 'human'): { wallet: Wallet | undefined } {
  const { address, chainId, connector, status } = useAccount();
  const { data: client } = useWalletClient();
  const { connectors, connectAsync } = useConnect();
  const tried = useRef(false);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_MODE !== 'local') return;
    if (tried.current || status === 'connecting' || status === 'reconnecting') return;
    const id = demoConnectorId(role);
    if (connector && (connector.id === id || !connector.id.startsWith('demo-'))) return;
    const demo = connectors.find((c) => c.id === id);
    if (!demo) return;
    tried.current = true;
    // two screens of one role may race to connect it; the loser's error is moot
    connectAsync({ connector: demo }).catch(() => undefined);
  }, [role, status, connector, connectors, connectAsync]);

  const wallet = useMemo(() => {
    if (!client || !address || !chainId || !connector) return undefined;
    const demo = connector.id.startsWith('demo-');
    return walletFor(client, demo ? 'demo' : 'injected', connector.name, address, chainId);
  }, [client, address, chainId, connector]);
  return { wallet };
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
