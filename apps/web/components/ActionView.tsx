'use client';

import { OnchainAction, type CouponLang, type ReviewRow } from '@ethglobal/ui/components';

import { explorerName, explorerTemplate } from '../lib/env';
import { elapsed, type ActionRow } from '../lib/onchain-action';

export interface ActionViewProps {
  row: ActionRow;
  now: number;
  title: string;
  network: string;
  networkLabel: string;
  review?: readonly ReviewRow[];
  worstCase?: string;
  actionLabel: string;
  walletName: string;
  simulation?: string;
  result?: string;
  blocked?: string;
  expectedMs: number;
  onConfirm?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
  /** The component's own status lines follow the page language (RT-W-08). */
  lang?: CouponLang;
  className?: string;
}

/**
 * Maps a reducer row onto the ui `OnchainAction` props union, so every transaction on every screen renders
 * through the same eight-state component (hash shown from `submitted` on, never a bare spinner).
 */
export function ActionView(p: ActionViewProps) {
  const url = explorerTemplate(p.network);
  const xName = explorerName(p.network);
  const common = {
    title: p.title,
    ...(p.review ? { review: p.review } : {}),
    ...(p.worstCase ? { worstCase: p.worstCase } : {}),
    network: p.networkLabel,
    ...(url ? { explorerUrl: url } : {}),
    ...(xName ? { explorerName: xName } : {}),
    ...(p.lang ? { lang: p.lang } : {}),
    ...(p.className ? { className: p.className } : {}),
  };
  const ms = elapsed(p.row, p.now);
  const hash = p.row.hash ?? '';
  switch (p.row.state) {
    case 'idle':
      return (
        <OnchainAction
          {...common}
          state="idle"
          actionLabel={p.actionLabel}
          walletName={p.walletName}
          {...(p.onConfirm ? { onConfirm: p.onConfirm } : {})}
          {...(p.blocked ? { blocked: p.blocked } : {})}
          {...(p.row.declined ? { declined: true } : {})}
        />
      );
    case 'signing':
      return (
        <OnchainAction
          {...common}
          state="signing"
          walletName={p.walletName}
          {...(p.simulation ? { simulation: p.simulation } : {})}
          {...(p.onCancel ? { onCancel: p.onCancel } : {})}
        />
      );
    case 'submitted':
    case 'pending':
      return (
        <OnchainAction
          {...common}
          state={p.row.state}
          hash={hash}
          elapsedMs={ms}
          expectedMs={p.expectedMs}
        />
      );
    case 'confirmed':
      return (
        <OnchainAction
          {...common}
          state="confirmed"
          hash={hash}
          result={p.result ?? ''}
          elapsedMs={ms}
        />
      );
    case 'finalized':
      return (
        <OnchainAction
          {...common}
          state="finalized"
          hash={hash}
          result={p.result ?? ''}
          elapsedMs={ms}
        />
      );
    case 'failed':
      return (
        <OnchainAction
          {...common}
          state="failed"
          reason={p.row.reason ?? 'the payment was not accepted'}
          {...(p.row.feeCharged ? { feeCharged: p.row.feeCharged } : {})}
          {...(p.row.hash ? { hash: p.row.hash } : {})}
          {...(p.onRetry ? { onRetry: p.onRetry } : {})}
        />
      );
    case 'replaced':
      return (
        <OnchainAction
          {...common}
          state="replaced"
          hash={hash}
          replacement={p.row.replacement ?? { hash, kind: 'speed-up' }}
        />
      );
  }
}
