import { describe, expect, it } from 'vitest';

import { canTransition, onchainActionStates, type OnchainActionState } from '@ethglobal/ui';

import {
  elapsed,
  IllegalTransition,
  initialRow,
  isStuckRow,
  reducer,
  replacementRow,
  type ActionEvent,
  type ActionRow,
} from '../lib/onchain-action';

/** One event that leads to each target state (and the edge it is defined on). */
const events: Record<string, ActionEvent> = {
  start: { type: 'start', at: 1_000 },
  signed: { type: 'signed', hash: '0xaa', at: 2_000 },
  rejected: { type: 'rejected' },
  preBroadcastError: { type: 'preBroadcastError', reason: 'no RPC' },
  seen: { type: 'seen' },
  confirmed: { type: 'confirmed', confirmations: 1 },
  finalized: { type: 'finalized' },
  reorg: { type: 'reorg' },
  replaced: { type: 'replaced', hash: '0xbb', kind: 'speed-up' },
  revert: { type: 'revert', reason: 'reverted', feeCharged: '0.0001 ETH' },
  retry: { type: 'retry' },
};

/** A row sitting in `state`, reached only through the reducer (never by setting state directly). */
function rowIn(state: OnchainActionState): ActionRow {
  const path: Record<OnchainActionState, (keyof typeof events)[]> = {
    idle: [],
    signing: ['start'],
    submitted: ['start', 'signed'],
    pending: ['start', 'signed', 'seen'],
    confirmed: ['start', 'signed', 'seen', 'confirmed'],
    finalized: ['start', 'signed', 'seen', 'confirmed', 'finalized'],
    failed: ['start', 'preBroadcastError'],
    replaced: ['start', 'signed', 'replaced'],
  };
  return path[state].reduce((row, name) => reducer(row, events[name] as ActionEvent), initialRow);
}

const TARGET: Record<ActionEvent['type'], OnchainActionState> = {
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
const target = (e: ActionEvent): OnchainActionState => TARGET[e.type];

describe('onchain-action reducer', () => {
  it('reaches every one of the eight states through events', () => {
    for (const s of onchainActionStates) expect(rowIn(s).state).toBe(s);
  });

  /** Every legal (state, event) pair — the README's "Leaves to" column, one event per edge. */
  const LEGAL: [OnchainActionState, keyof typeof events][] = [
    ['idle', 'start'],
    ['signing', 'signed'],
    ['signing', 'rejected'],
    ['signing', 'preBroadcastError'],
    ['signing', 'revert'],
    ['submitted', 'seen'],
    ['submitted', 'revert'],
    ['submitted', 'replaced'],
    ['pending', 'confirmed'],
    ['pending', 'revert'],
    ['pending', 'replaced'],
    ['confirmed', 'finalized'],
    ['confirmed', 'reorg'],
    ['failed', 'retry'],
  ];
  const isLegal = (from: OnchainActionState, name: string) => LEGAL.some(([f, e]) => f === from && e === name);

  it('accepts every legal transition and lands on the event’s state, inside canTransition', () => {
    for (const [from, name] of LEGAL) {
      const event = events[name] as ActionEvent;
      expect(canTransition(from, target(event))).toBe(true);
      expect(reducer(rowIn(from), event).state, `${from} --${name}-->`).toBe(target(event));
    }
  });

  it('rejects every illegal transition (throws outside production)', () => {
    let rejected = 0;
    for (const from of onchainActionStates) {
      for (const [name, event] of Object.entries(events)) {
        if (isLegal(from, name)) continue;
        expect(() => reducer(rowIn(from), event), `${from} --${name}-->`).toThrow(IllegalTransition);
        rejected += 1;
      }
    }
    expect(rejected).toBe(8 * 11 - LEGAL.length);
  });

  it('keeps finalized and replaced terminal', () => {
    for (const e of Object.values(events)) {
      expect(() => reducer(rowIn('finalized'), e)).toThrow(IllegalTransition);
      expect(() => reducer(rowIn('replaced'), e)).toThrow(IllegalTransition);
    }
  });

  it('a wallet rejection returns to idle with inputs intact and a neutral "declined" flag', () => {
    const row = reducer(rowIn('signing'), events.rejected as ActionEvent);
    expect(row).toEqual({ state: 'idle', declined: true });
    expect(reducer(row, events.start as ActionEvent).declined).toBeUndefined();
  });

  it('the hash exists from submitted on and survives to finalized', () => {
    expect(rowIn('signing').hash).toBeUndefined();
    for (const s of ['submitted', 'pending', 'confirmed', 'finalized'] as const) expect(rowIn(s).hash).toBe('0xaa');
  });

  it('a revert carries the decoded reason and the fee still charged', () => {
    const row = reducer(rowIn('pending'), events.revert as ActionEvent);
    expect(row).toMatchObject({ state: 'failed', reason: 'reverted', feeCharged: '0.0001 ETH', hash: '0xaa' });
    expect(reducer(row, events.retry as ActionEvent)).toEqual({ state: 'idle' });
  });

  it('a reorg takes confirmed back to pending', () => {
    expect(reducer(rowIn('confirmed'), events.reorg as ActionEvent)).toMatchObject({ state: 'pending', confirmations: 0 });
  });

  it('the stuck flag rises after 2 × the expected time, only while submitted or pending', () => {
    const submitted = rowIn('submitted'); // submittedAt 2_000
    expect(elapsed(submitted, 4_000)).toBe(2_000);
    expect(isStuckRow(submitted, 2_000 + 2_000, 1_000)).toBe(false);
    expect(isStuckRow(submitted, 2_000 + 2_001, 1_000)).toBe(true);
    expect(isStuckRow(rowIn('pending'), 10_000, 1_000)).toBe(true);
    expect(isStuckRow(rowIn('confirmed'), 10_000, 1_000)).toBe(false);
    expect(isStuckRow(rowIn('signing'), 10_000, 1_000)).toBe(false);
  });

  it('a replacement starts a new row at submitted with the new hash', () => {
    const old = rowIn('replaced');
    expect(old.replacement).toEqual({ hash: '0xbb', kind: 'speed-up' });
    expect(replacementRow(old, 9_000)).toEqual({ state: 'submitted', hash: '0xbb', submittedAt: 9_000, startedAt: 9_000 });
    expect(replacementRow(rowIn('pending'), 9_000)).toBeUndefined();
  });
});
