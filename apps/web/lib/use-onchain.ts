'use client';

import { useCallback, useReducer } from 'react';
import { formatEther, type PublicClient } from 'viem';

import { useClock } from './hooks';
import { type ActionEvent, type ActionRow, initialRow, reducer } from './onchain-action';
import { pending } from './store';

/** Typical time to the next state per network (ring size; stuck = 2×). */
export function expectedMsFor(network: string | undefined): number {
  if (network === 'eip155:31337') return 1_000;
  if (network?.startsWith('hedera:')) return 3_000;
  return 2_000;
}

/** The reducer plus a clock that ticks while a hash is in flight (for "4 s" and the ring). */
export function useOnchainAction() {
  // `null` starts a NEW row for the next transaction on the same screen; everything else goes through the guard
  const [row, dispatch] = useReducer(
    (current: ActionRow, event: ActionEvent | null) =>
      event ? reducer(current, event) : initialRow,
    initialRow,
  );
  const live = row.state === 'signing' || row.state === 'submitted' || row.state === 'pending';
  const now = useClock(250, live);
  const send = useCallback((event: ActionEvent) => dispatch(event), []);
  const newRow = useCallback(() => dispatch(null), []);
  return { row, dispatch: send, newRow, now };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Hedera's JSON-RPC relay answers a receipt poll for a transaction the network refused (WRONG_NONCE,
 * INSUFFICIENT_TX_FEE, …) with an error naming that status instead of a null receipt; that is final.
 */
export function hederaRejection(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let e: unknown = error;
  while (e && typeof e === 'object' && !seen.has(e)) {
    seen.add(e);
    const o = e as {
      data?: { hederaStatus?: unknown };
      details?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (typeof o.data?.hederaStatus === 'string') return o.data.hederaStatus;
    for (const text of [o.details, o.message])
      if (typeof text === 'string') {
        const m = /Transaction rejected: ([A-Z_]+)/.exec(text);
        if (m?.[1]) return m[1];
      }
    e = o.cause;
  }
  return undefined;
}

/**
 * Follows a broadcast (or settled) transaction to finality: seen → confirmed → finalized, or revert.
 * Anvil: next block; other EVM networks: the `safe` block. Hedera consensus receipts are final,
 * including EVM chains 295/296: wallet providers can cache their `safe` tag behind a confirmed receipt.
 */
export async function followTransaction(opts: {
  hash: string;
  network: string;
  label: string;
  reader: PublicClient | undefined;
  dispatch: (event: ActionEvent) => void;
  signal?: { cancelled: boolean };
}): Promise<'finalized' | 'failed' | 'pending'> {
  const { hash, network, reader, dispatch } = opts;
  await pending.add({ hash, network, label: opts.label, at: Date.now() });
  let terminal = false;
  const unresolved = () => {
    dispatch({
      type: 'uncertain',
      reason:
        'The transaction is still being checked. Its hash is saved on this device; check it again before sending another transaction.',
    });
    return 'pending' as const;
  };
  try {
    if (network.startsWith('hedera:') || !reader || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      dispatch({ type: 'seen' });
      dispatch({ type: 'confirmed', confirmations: 1 });
      dispatch({ type: 'finalized' });
      terminal = true;
      return 'finalized';
    }
    const h = hash as `0x${string}`;
    let seen = false;
    for (let i = 0; i < 240 && !opts.signal?.cancelled; i += 1) {
      let rejected: string | undefined;
      const receipt = await reader.getTransactionReceipt({ hash: h }).catch((error: unknown) => {
        rejected = hederaRejection(error);
        return undefined;
      });
      if (rejected !== undefined) {
        dispatch({ type: 'revert', reason: `the network refused it: ${rejected}` });
        terminal = true;
        return 'failed';
      }
      if (!seen && (receipt || (await reader.getTransaction({ hash: h }).catch(() => undefined)))) {
        seen = true;
        dispatch({ type: 'seen' });
      }
      if (receipt) {
        if (receipt.status !== 'success') {
          dispatch({
            type: 'revert',
            reason: 'the contract reverted the transaction',
            // nosemgrep: recharge-usdc-18-decimals — the gas fee is native ETH (18 dp), not a USDC amount
            feeCharged: `${formatEther(receipt.gasUsed * receipt.effectiveGasPrice)} ETH`,
          });
          terminal = true;
          return 'failed';
        }
        dispatch({ type: 'confirmed', confirmations: 1 });
        if (network === 'eip155:295' || network === 'eip155:296') {
          dispatch({ type: 'finalized' });
          terminal = true;
          return 'finalized';
        }
        const tag = network === 'eip155:31337' ? 'latest' : 'safe';
        for (let j = 0; j < 240 && !opts.signal?.cancelled; j += 1) {
          const block = await reader.getBlock({ blockTag: tag }).catch(() => undefined);
          if (block && block.number !== null && block.number >= receipt.blockNumber) {
            dispatch({ type: 'finalized' });
            terminal = true;
            return 'finalized';
          }
          await sleep(250);
        }
        return unresolved();
      }
      await sleep(250);
    }
    return unresolved();
  } finally {
    if (terminal) await pending.remove(hash);
  }
}

export type { ActionRow };
