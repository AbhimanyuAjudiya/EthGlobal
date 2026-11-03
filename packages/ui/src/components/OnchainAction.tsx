'use client';

import { useId } from 'react';

import { Button } from './Button';
import { cx } from './format';
import { Hash } from './Hash';
import { RuledList, type RuledRow } from './RuledList';

import type { OnchainActionState } from '../../index';
import type { ReactNode } from 'react';

export interface ReviewRow {
  label: string;
  value: ReactNode;
}

interface Common {
  /** The sheet's one line, carrying the amount: "Add 100 MB · $0.40". */
  title: string;
  /** Review lines: valid until, pay from (network name, never a chain id), itemised network fee. */
  review?: readonly ReviewRow[];
  /** Worst case in plain words: "Worst case: if settlement fails you pay nothing. This approval expires in 5:00". */
  worstCase?: string;
  /** Network name for Sending/Final lines: "Hedera", "Base". */
  network?: string;
  /** Explorer URL template with a `{hash}` placeholder; omitted → no link (local chain). */
  explorerUrl?: string;
  explorerName?: string;
  className?: string;
}

interface Timing {
  /** Elapsed since broadcast; drives "4 s" and the determinate ring. */
  elapsedMs: number;
  /** Typical time to the next state for this chain; the ring is sized to it, stuck = 2×. */
  expectedMs: number;
}

export type OnchainActionProps = Common &
  (
    | {
        state: 'idle';
        /** The primary button, with the amount: "Pay $0.40 USDC". */
        actionLabel: string;
        onConfirm?: () => void;
        /** A pre-flight check failed; the wallet must not open. Plain words, one sentence. */
        blocked?: string;
        /** Set after the signing → idle edge: the wallet declined. Neutral, inputs intact. */
        declined?: boolean;
        walletName?: string;
      }
    | {
        state: 'signing';
        walletName: string;
        /** What leaves and what arrives: "0.40 USDC leaves your account; 100 MB arrives". */
        simulation?: string;
        onCancel?: () => void;
      }
    | ({
        state: 'submitted' | 'pending';
        hash: string;
        onSpeedUp?: () => void;
        onCancelTx?: () => void;
      } & Timing)
    | {
        state: 'confirmed';
        hash: string;
        /** "+100 MB · settled · 400 MB total". */
        result: string;
        /** Available and pending shown apart while settling. */
        balances?: { available: string; pending: string };
        elapsedMs?: number;
      }
    | {
        state: 'finalized';
        hash: string;
        result: string;
        elapsedMs?: number;
      }
    | {
        state: 'failed';
        /** Decoded, plain words, no trailing full stop: "the facilitator rejected the signature (expired)". */
        reason: string;
        /** The network fee that was still charged on chain ("$0.01"); omitted when nothing left the account. */
        feeCharged?: string;
        hash?: string;
        onRetry?: () => void;
      }
    | {
        state: 'replaced';
        hash: string;
        replacement: { hash: string; kind: 'speed-up' | 'cancel' };
        /** The fee the cancelled transaction still cost; shown for kind = cancel. */
        feeCharged?: string;
      }
  );

const seconds = (ms: number) => `${Math.max(0, Math.round(ms / 1000))} s`;

/** True after 2× the expected time while submitted or pending: the row offers speed up / cancel. */
export function isStuck(state: OnchainActionState, elapsedMs: number, expectedMs: number): boolean {
  return (state === 'submitted' || state === 'pending') && elapsedMs > 2 * expectedMs;
}

/** A determinate ring sized to the chain's typical time; drawn from props, never spinning on its own. */
function Ring({ elapsedMs, expectedMs }: Timing) {
  const r = 7;
  const circumference = 2 * Math.PI * r;
  const progress = Math.min(1, expectedMs > 0 ? elapsedMs / expectedMs : 1);
  return (
    <svg className="onchain-action__ring" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <circle className="onchain-action__ring-track" cx="10" cy="10" r={r} />
      <circle
        className="onchain-action__ring-fill"
        cx="10"
        cy="10"
        r={r}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progress)}
        transform="rotate(-90 10 10)"
      />
    </svg>
  );
}

/**
 * The eight-state onchain action (packages/ui/README.md), receipt-shaped: one component for every
 * transaction. The hash appears in the first state that has one and every 0x value is copyable.
 */
export function OnchainAction(props: OnchainActionProps) {
  const { title, review, worstCase, network, explorerUrl, explorerName, className } = props;
  const headingId = useId();
  const hashOf = (value: string, kind = 'transaction hash') => (
    <Hash
      value={value}
      kind={kind}
      {...(explorerUrl ? { explorerHref: explorerUrl.replace('{hash}', value) } : {})}
      {...(explorerName ? { explorerName } : {})}
    />
  );

  let status: ReactNode = null;
  let body: ReactNode = null;
  let actions: ReactNode = null;

  switch (props.state) {
    case 'idle': {
      status = props.declined
        ? `You declined in ${props.walletName ?? 'your wallet'}. Nothing was sent.`
        : null;
      body = props.blocked ? <p className="onchain-action__blocked">{props.blocked}</p> : null;
      actions = (
        <Button block onClick={props.onConfirm} disabled={Boolean(props.blocked)}>
          {props.actionLabel}
        </Button>
      );
      break;
    }
    case 'signing': {
      status = `Approve in ${props.walletName}…`;
      body = props.simulation ? <p className="onchain-action__note">{props.simulation}</p> : null;
      actions = (
        <Button variant="quiet" onClick={props.onCancel}>
          Cancel
        </Button>
      );
      break;
    }
    case 'submitted':
    case 'pending': {
      const stuck = isStuck(props.state, props.elapsedMs, props.expectedMs);
      status = (
        <>
          <Ring elapsedMs={props.elapsedMs} expectedMs={props.expectedMs} />
          <span>{props.state === 'pending' ? 'Sending · seen by the network' : 'Sending'}</span>
          <span className="onchain-action__sep"> · </span>
          {hashOf(props.hash)}
          <span className="onchain-action__sep"> · </span>
          <span className="onchain-action__elapsed">{seconds(props.elapsedMs)}</span>
        </>
      );
      if (stuck) {
        body = (
          <p className="onchain-action__note">
            Slower than usual: {seconds(props.elapsedMs)}, usually {seconds(props.expectedMs)}. Speed
            up, or cancel with a replacement.
          </p>
        );
        actions = (
          <>
            <Button variant="secondary" onClick={props.onSpeedUp}>
              Speed up
            </Button>
            <Button variant="quiet" onClick={props.onCancelTx}>
              Cancel transaction
            </Button>
          </>
        );
      }
      break;
    }
    case 'confirmed': {
      status = (
        <>
          <span>Confirmed</span>
          {network ? <span>{` · ${network}`}</span> : null}
          <span className="onchain-action__sep"> · </span>
          {hashOf(props.hash)}
          {props.elapsedMs !== undefined ? (
            <span className="onchain-action__elapsed">{` · ${seconds(props.elapsedMs)}`}</span>
          ) : null}
        </>
      );
      body = (
        <>
          <p className="onchain-action__result">
            {props.result} <span className="onchain-action__tag">settling</span>
          </p>
          {props.balances ? (
            <RuledList
              rows={[
                { label: 'Available', value: props.balances.available },
                { label: 'Pending', value: props.balances.pending },
              ]}
            />
          ) : null}
        </>
      );
      break;
    }
    case 'finalized': {
      status = (
        <>
          <span>Paid · Final</span>
          {network ? <span>{` · ${network}`}</span> : null}
          <span className="onchain-action__sep"> · </span>
          {hashOf(props.hash)}
        </>
      );
      body = <p className="onchain-action__result">{props.result}</p>;
      break;
    }
    case 'failed': {
      const charged = props.feeCharged
        ? `Nothing left your account except the ${props.feeCharged} network fee.`
        : 'Nothing left your account.';
      status = <span className="onchain-action__failed">Didn&apos;t go through</span>;
      body = (
        <>
          <p className="onchain-action__note">
            Didn&apos;t go through: {props.reason}. {charged}
          </p>
          {props.hash ? <p className="onchain-action__hashline">{hashOf(props.hash)}</p> : null}
        </>
      );
      actions = (
        <Button variant="secondary" onClick={props.onRetry}>
          Try again
        </Button>
      );
      break;
    }
    case 'replaced': {
      const { kind } = props.replacement;
      status = (
        <>
          <span>{kind === 'cancel' ? 'Cancelled' : 'Replaced'}</span>
          <span className="onchain-action__sep"> · </span>
          {hashOf(props.hash)}
        </>
      );
      body = (
        <p className="onchain-action__note">
          {kind === 'cancel'
            ? `Cancelled with a replacement. ${props.feeCharged ? `Only the ${props.feeCharged} network fee was charged.` : 'Only the network fee was charged.'}`
            : 'Sped up with a replacement; it continues as '}
          {kind === 'cancel' ? null : hashOf(props.replacement.hash, 'replacement hash')}
          {kind === 'cancel' ? (
            <span className="onchain-action__hashline">
              {' '}
              Replacement {hashOf(props.replacement.hash, 'replacement hash')}
            </span>
          ) : null}
        </p>
      );
      break;
    }
  }

  const rows: RuledRow[] = (review ?? []).map((row) => ({ label: row.label, value: row.value }));

  return (
    <section
      className={cx('onchain-action', className)}
      data-state={props.state}
      aria-labelledby={headingId}
    >
      <h2 className="onchain-action__title" id={headingId}>
        {title}
      </h2>
      {rows.length > 0 ? <RuledList rows={rows} className="onchain-action__review" /> : null}
      {worstCase && (props.state === 'idle' || props.state === 'signing') ? (
        <p className="onchain-action__worst">{worstCase}</p>
      ) : null}
      <div className="onchain-action__status" role="status">
        {status}
      </div>
      {body}
      {actions ? <div className="onchain-action__actions">{actions}</div> : null}
    </section>
  );
}
