/**
 * RT-A-17 (T-24, T-60): a free claim served on-chain whose 202 never reached the client (the browser timed out, the
 * memory-only session key is gone) is re-bound to the same human's next session key while the profile is pending;
 * never once the LPA is sealed, never for another human, at most 3 times an hour.
 */
import { describe, expect, it } from 'vitest';

import { MockReseller } from '@ethglobal/adapters';
import { lpaAad, openLpa, type SealedBox } from '@ethglobal/crypto';
import type { Hex } from '@ethglobal/protocol/ids';
import type { EntitledResponse } from '@ethglobal/protocol/schemas';

import { errorOf, harness, type Harness } from '../support/harness.js';

/** The reseller is down for the first order: the claim is served on-chain and answers 202 pending-profile. */
const outage = () =>
  harness({ overrides: { adapters: { reseller: new MockReseller({ failNextOrder: true }) } } });

async function servedPending(h: Harness, seed: string) {
  const first = await h.claim({ seed });
  expect(first.res.status).toBe(202);
  const body = (await first.res.json()) as EntitledResponse;
  expect(body.status).toBe('pending-profile');
  return { ...first, body, key: body.entitlementKey };
}

/** /me retries the order (T-25); the sealed blob the ledger references, as the delivery route will read it. */
async function sealedBy(h: Harness, key: string): Promise<SealedBox> {
  const me = (await (await h.get(`/me/${encodeURIComponent(key)}`)).json()) as { status: string };
  expect(me.status).toBe('ready');
  const found = await h.deps.stores.entitlements.getByKey(key);
  const blob = await h.adapters.blobs.get(found?.payload.sealedRef ?? '');
  return JSON.parse(new TextDecoder().decode(blob ?? new Uint8Array())) as SealedBox;
}

const opens = (box: SealedBox, secretKey: Uint8Array, nonce: string, key: string) =>
  openLpa(box, secretKey, lpaAad(nonce as Hex, key));

describe('RT-A-17 claim re-bind (T-24, T-60)', () => {
  it('the same human from a new session: the same 202 and plan key, the LPA then seals to the new key only', async () => {
    const h = await outage();
    const first = await servedPending(h, 'rt-a-17');
    const again = await h.claim({ seed: 'rt-a-17' }); // a fresh keypair: the reloaded page
    expect(again.res.status).toBe(202);
    expect(await again.res.json()).toEqual(first.body);
    expect(h.deps.pendingDelivery.get(first.key)).toEqual({
      sessionPubKey: again.spk,
      nonce: again.challenge.nonce,
    });
    expect([h.dataDrop.claimedEvents.length, h.reseller.orders().length]).toEqual([1, 0]);
    expect(h.lines.join('')).toContain('"event":"claim.rebind"');
    const sealed = await sealedBy(h, first.key);
    expect(opens(sealed, again.keys.secretKey, again.challenge.nonce, first.key)).toMatch(
      /^LPA:1\$/,
    );
    expect(() => opens(sealed, first.keys.secretKey, first.challenge.nonce, first.key)).toThrow();
  });

  it('once the LPA is sealed the first session owns it: a new session is a replay and the target does not move', async () => {
    const h = await outage();
    const first = await servedPending(h, 'rt-a-17-sealed');
    const sealed = await sealedBy(h, first.key);
    const again = await h.claim({ seed: 'rt-a-17-sealed' });
    expect([again.res.status, await errorOf(again.res)]).toEqual([409, 'replay']);
    expect(h.deps.pendingDelivery.get(first.key)).toBeUndefined();
    expect(opens(sealed, first.keys.secretKey, first.challenge.nonce, first.key)).toMatch(
      /^LPA:1\$/,
    );
    expect(() => opens(sealed, again.keys.secretKey, again.challenge.nonce, first.key)).toThrow();
  });

  it('another human on the same session key and campaign is judged on their own; the pending target is untouched', async () => {
    const h = await outage();
    const first = await servedPending(h, 'rt-a-17-owner');
    const other = await h.claim({ seed: 'rt-a-17-other', keys: first.keys });
    expect(other.res.status).toBe(201);
    expect(h.deps.pendingDelivery.get(first.key)).toEqual({
      sessionPubKey: first.spk,
      nonce: first.challenge.nonce,
    });
    expect(h.dataDrop.claimedEvents).toHaveLength(2);
  });

  it('at most 3 re-binds an hour per entitlement (429 rate_limited), then the window passes', async () => {
    const h = await outage();
    const first = await servedPending(h, 'rt-a-17-limit');
    for (let i = 0; i < 3; i++)
      expect((await h.claim({ seed: 'rt-a-17-limit' })).res.status).toBe(202);
    const fourth = await h.claim({ seed: 'rt-a-17-limit' });
    expect([fourth.res.status, await errorOf(fourth.res)]).toEqual([429, 'rate_limited']);
    const last = h.deps.pendingDelivery.get(first.key);
    expect(last?.sessionPubKey).not.toBe(fourth.spk);
    h.clock.advance(3_600_000);
    const later = await h.claim({ seed: 'rt-a-17-limit' });
    expect(later.res.status).toBe(202);
    expect(h.deps.pendingDelivery.get(first.key)?.sessionPubKey).toBe(later.spk);
  });
});
