import { describe, expect, it } from 'vitest';

import { InMemoryLedger } from '@ethglobal/adapters';
import { fakeClock } from '@ethglobal/adapters/testing';
import { hmacKey } from '@ethglobal/crypto';
import type { Hex } from '@ethglobal/protocol/ids';

import { GiftStore } from '../../src/store/index.js';
import { gift, GIFT_ID, SECRET, T0 } from '../helpers.js';

const setup = () => {
  const clock = fakeClock();
  const ledger = new InMemoryLedger({ now: clock.now });
  return { clock, store: new GiftStore(ledger, clock.now) };
};
const OTHER: Hex = `0x${'9e'.repeat(32)}`;

describe('GiftStore', () => {
  it('openByNamehash returns only open gifts', async () => {
    const { store } = setup();
    const g = gift();
    await store.create(g);
    await store.create(
      gift({ giftId: OTHER, serial: OTHER.slice(2, 10), pinKey: `0x${'7d'.repeat(32)}` }),
    );
    expect(
      await store.openByNamehash(g.namehash!.toUpperCase().replace('0X', '0x') as Hex),
    ).toHaveLength(2);
    await store.markClaimed(OTHER, 'giftent:x');
    const open = await store.openByNamehash(g.namehash as Hex);
    expect(open.map((f) => f.payload.giftId)).toEqual([GIFT_ID]);
  });

  it('byPinKey / bySerial; a wrong PIN key finds nothing', async () => {
    const { store } = setup();
    const g = gift();
    await store.create(g);
    expect(await store.byPinKey(g.pinKey as Hex)).toMatchObject({ payload: { giftId: GIFT_ID } });
    expect(await store.byPinKey(hmacKey(SECRET, 'pin', '0000000000000000'))).toBeNull();
    expect(await store.bySerial(g.serial.toUpperCase())).toMatchObject({
      payload: { giftId: GIFT_ID },
    });
  });

  it('markClaimed is idempotent for one key, refuses another, and nothing claims after claimBy', async () => {
    const { clock, store } = setup();
    await store.create(gift());
    await store.markClaimed(GIFT_ID, 'giftent:a');
    await store.markClaimed(GIFT_ID, 'giftent:a');
    expect(await store.bySerial(GIFT_ID.slice(2, 10))).toMatchObject({
      payload: { state: 'claimed', claimedKey: 'giftent:a' },
    });
    await expect(store.markClaimed(GIFT_ID, 'giftent:b')).rejects.toMatchObject({
      code: 'already_claimed',
    });
    clock.set(T0 + 7 * 86_400_000);
    await expect(store.markClaimed(GIFT_ID, 'giftent:a')).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
