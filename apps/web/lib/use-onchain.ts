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
    (current: ActionRow, event: ActionEvent | null) => (event ? reducer(current, event) : initialRow),
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
 * Follows a broadcast (or settled) transaction to finality: seen → confirmed → finalized, or revert.
 * Anvil: next block; EVM testnets: the `safe` block; Hedera: consensus is final (no EVM read here).
 */
export async function followTransaction(opts: {
  hash: string;
  network: string;
  label: string;
  reader: PublicClient | undefined;
  dispatch: (event: ActionEvent) => void;
  signal?: { cancelled: boolean };
}): Promise<'finalized' | 'failed'> {
  const { hash, network, reader, dispatch } = opts;
  await pending.add({ hash, network, label: opts.label, at: Date.now() });
  try {
    if (network.startsWith('hedera:') || !reader || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      dispatch({ type: 'seen' });
      dispatch({ type: 'confirmed', confirmations: 1 });
      dispatch({ type: 'finalized' });
      return 'finalized';
    }
    const h = hash as `0x${string}`;
    let seen = false;
    for (let i = 0; i < 240 && !opts.signal?.cancelled; i += 1) {
      const receipt = await reader.getTransactionReceipt({ hash: h }).catch(() => undefined);
      if (!seen && (receipt || (await reader.getTransaction({ hash: h }).catch(() => undefined)))) {
        seen = true;
        dispatch({ type: 'seen' });
      }
      if (receipt) {
        if (receipt.status !== 'success') {
          dispatch({
            type: 'revert',
            reason: 'the contract reverted the transaction',
            feeCharged: `${formatEther(receipt.gasUsed * receipt.effectiveGasPrice)} ETH`,
          });
          return 'failed';
        }
        dispatch({ type: 'confirmed', confirmations: 1 });
        const tag = network === 'eip155:31337' ? 'latest' : 'safe';
        for (let j = 0; j < 240 && !opts.signal?.cancelled; j += 1) {
          const block = await reader.getBlock({ blockTag: tag }).catch(() => undefined);
          if (block && block.number !== null && block.number > receipt.blockNumber) {
            dispatch({ type: 'finalized' });
            return 'finalized';
          }
          await sleep(250);
        }
        return 'failed';
      }
      await sleep(250);
    }
    return 'failed';
  } finally {
    await pending.remove(hash);
  }
}

export type { ActionRow };
