import { describe, expect, it } from 'vitest';

import { InMemoryLedger } from '@ethglobal/adapters';
import { fakeClock } from '@ethglobal/adapters/testing';
import { AUDIENCE } from '@ethglobal/protocol/ids';

import { challenge, consumeChallenge } from '../../src/index.js';
import { NonceStore } from '../../src/store/index.js';
import { forge, SECRET, SPK, T0 } from '../helpers.js';

describe('NonceStore', () => {
  it('consume then consumed; after NONCE_TTL_S (A-37) the store forgets but the MAC still says expired', async () => {
    const clock = fakeClock();
    const ledger = new InMemoryLedger({ now: clock.now });
    const store = new NonceStore(ledger, clock.now);
    const c = challenge(AUDIENCE, '/claim', SPK, T0, SECRET);
    expect(await store.consumed(c.nonce)).toBe(false);
    await store.consume(c, T0);
    expect(await store.consumed(c.nonce.toUpperCase().replace('0X', '0x') as typeof c.nonce)).toBe(
      true,
    );
    const [row] = await ledger.query({ annotations: { type: 'nonce' } });
    expect(row).toMatchObject({
      expiresAt: T0 + 300_000,
      annotations: { key: `nonce:${c.nonce}`, nonce: c.nonce },
    });
    expect(JSON.parse(row!.payload)).toMatchObject({ issuedAt: T0, exp: T0 + 120_000 });
    await expect(store.consume(c, T0)).rejects.toMatchObject({ code: 'replay' }); // create-if-absent
    clock.advance(121_000);
    expect(await store.consumed(c.nonce)).toBe(true); // still held after the challenge died
    expect(await consumeChallenge(ledger, new Set(), c, SPK, clock.now(), SECRET)).toBe('expired');
    clock.advance(180_000);
    expect(await store.consumed(c.nonce)).toBe(false);
    expect(await consumeChallenge(ledger, new Set(), c, SPK, clock.now(), SECRET)).toBe('expired');
  });

  it('a malformed row under the key still counts as consumed (fail closed)', async () => {
    const ledger = new InMemoryLedger({ now: () => T0 });
    const nonce = `0x${'12'.repeat(32)}` as const;
    await forge(ledger, { type: 'nonce', key: `nonce:${nonce}` }, 'garbage', 120);
    expect(await new NonceStore(ledger, () => T0).consumed(nonce)).toBe(true);
  });
});
