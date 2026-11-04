/**
 * The eight-state onchain action as a reducer (web.md §3; packages/ui/README.md "Onchain action states").
 * Every transition goes through `canTransition`; an illegal one throws in development and is logged and ignored
 * in production. "Stuck" is derived (elapsed > 2 × expected while submitted|pending), never a state.
 */
import { canTransition, type OnchainActionState } from '@ethglobal/ui';

export interface ActionRow {
  state: OnchainActionState;
  /** Set from `submitted` on; shown the moment it exists. */
  hash?: string;
  /** When signing began / when the hash appeared (ms). */
  startedAt?: number;
  submittedAt?: number;
  confirmations?: number;
  /** Decoded, plain words (failed). */
  reason?: string;
  /** The network fee still charged on chain (failed after broadcast). */
  feeCharged?: string;
  /** The signing → idle edge happened: wallet declined, inputs intact. */
  declined?: boolean;
  replacement?: { hash: string; kind: 'speed-up' | 'cancel' };
}

export type ActionEvent =
  | { type: 'start'; at: number }
  | { type: 'signed'; hash: string; at: number }
  | { type: 'rejected' }
  | { type: 'preBroadcastError'; reason: string }
  | { type: 'seen' }
  | { type: 'confirmed'; confirmations: number }
  | { type: 'finalized' }
  | { type: 'reorg' }
  | { type: 'replaced'; hash: string; kind: 'speed-up' | 'cancel' }
  | { type: 'revert'; reason: string; feeCharged?: string }
  | { type: 'retry' };

export const initialRow: ActionRow = { state: 'idle' };

const target: Record<ActionEvent['type'], OnchainActionState> = {
  start: 'signing',
  signed: 'submitted',
  rejected: 'idle',
  preBroadcastError: 'failed',
  seen: 'pending',
  confirmed: 'confirmed',
  finalized: 'finalized',
  reorg: 'pending',
  replaced: 'replaced',
  revert: 'failed',
  retry: 'idle',
};

const ONLY_FROM: Partial<Record<ActionEvent['type'], OnchainActionState>> = {
  rejected: 'signing',
  preBroadcastError: 'signing',
  seen: 'submitted',
  reorg: 'confirmed',
  retry: 'failed',
};

export class IllegalTransition extends Error {
  override readonly name = 'IllegalTransition';
  constructor(
    readonly from: OnchainActionState,
    readonly event: ActionEvent['type'],
  ) {
    super(`illegal onchain transition ${from} --${event}-->`);
  }
}

const strict = process.env.NODE_ENV !== 'production';

export function reducer(row: ActionRow, event: ActionEvent): ActionRow {
  const to = target[event.type];
  // events name their edge: rejected/preBroadcastError leave signing, seen leaves submitted, reorg leaves
  // confirmed, retry leaves failed — on top of the state machine's own canTransition guard
  const edgeOk = canTransition(row.state, to) && (ONLY_FROM[event.type] ?? row.state) === row.state;
  if (!edgeOk) {
    if (strict) throw new IllegalTransition(row.state, event.type);
    console.warn(new IllegalTransition(row.state, event.type).message);
    return row;
  }
  switch (event.type) {
    case 'start':
      return { state: 'signing', startedAt: event.at };
    case 'signed':
      return { ...row, state: 'submitted', hash: event.hash, submittedAt: event.at };
    case 'rejected':
      return { state: 'idle', declined: true };
    case 'preBroadcastError':
      return { state: 'failed', reason: event.reason };
    case 'seen':
      return { ...row, state: 'pending' };
    case 'confirmed':
      return { ...row, state: 'confirmed', confirmations: event.confirmations };
    case 'finalized':
      return { ...row, state: 'finalized' };
    case 'reorg':
      return { ...row, state: 'pending', confirmations: 0 };
    case 'replaced':
      return { ...row, state: 'replaced', replacement: { hash: event.hash, kind: event.kind } };
    case 'revert':
      return {
        ...row,
        state: 'failed',
        reason: event.reason,
        ...(event.feeCharged ? { feeCharged: event.feeCharged } : {}),
      };
    case 'retry':
      return { state: 'idle' };
  }
}

/** A replacement starts a NEW row at `submitted` with the new hash (the old row ends at `replaced`). */
export function replacementRow(replaced: ActionRow, at: number): ActionRow | undefined {
  if (replaced.state !== 'replaced' || !replaced.replacement) return undefined;
  return { state: 'submitted', hash: replaced.replacement.hash, submittedAt: at, startedAt: at };
}

/** Elapsed since the hash appeared (or since signing began). */
export const elapsed = (row: ActionRow, now: number): number =>
  Math.max(0, now - (row.submittedAt ?? row.startedAt ?? now));

/** The stuck flag: 2 × expected while submitted or pending. */
export const isStuckRow = (row: ActionRow, now: number, expectedMs: number): boolean =>
  (row.state === 'submitted' || row.state === 'pending') && elapsed(row, now) > 2 * expectedMs;
