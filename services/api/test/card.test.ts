import { describe, expect, it, vi } from 'vitest';

import { randomBytes } from '@ethglobal/crypto';
import { generatePin } from '@ethglobal/protocol/pin';

import { errorOf, harness, redeemPin, seedCard } from './support/harness.js';

describe('scratch cards', () => {
  it('GET /card/:serial never changes state (bot UA, prefetch, ?pin=) (T-47)', async () => {
    const h = await harness();
    const card = await seedCard(h);
    const update = vi.spyOn(h.adapters.ledger, 'update');
    const put = vi.spyOn(h.adapters.ledger, 'put');
    for (const headers of [
      { 'user-agent': 'TelegramBot' },
      { 'user-agent': 'facebookexternalhit/1.1' },
      { purpose: 'prefetch' },
      { 'sec-purpose': 'prefetch' },
    ]) {
      const res = await h.get(`/card/${card.serial}?pin=${card.pin}`, headers);
      expect(await res.json()).toMatchObject({
        serial: card.serial,
        mb: 300,
        state: 'open',
        sponsorName: 'Mumbai Welcome',
      });
    }
    expect(update).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('unknown serial → 404', async () => {
    const h = await harness();
    expect((await h.get('/card/deadbeef')).status).toBe(404);
    expect((await h.get('/card/NOT-A-SERIAL')).status).toBe(404);
  });

  it('POST /card/redeem valid PIN → 201 and DataDrop.claim for the campaign-funded card; redeemed → 410', async () => {
    const h = await harness();
    const card = await seedCard(h);
    const res = await redeemPin(h, card.pin);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { kind: string; claimTx: string }).kind).toBe('card');
    expect(h.dataDrop.claimedEvents).toHaveLength(1);
    expect(await errorOf(await redeemPin(h, card.pin))).toBe('expired');
    expect(((await (await h.get(`/card/${card.serial}`)).json()) as { state: string }).state).toBe(
      'claimed',
    );
  });

  it('a Verhoeff-invalid PIN → 400; a valid-looking unknown PIN → 401 (same body as a wrong PIN)', async () => {
    const h = await harness();
    expect((await redeemPin(h, '1234567890123456')).status).toBe(400);
    await seedCard(h);
    const unknown = await redeemPin(h, generatePin(randomBytes));
    expect([unknown.status, await unknown.json()]).toEqual([
      401,
      expect.objectContaining({
        error: 'unauthorized',
        details: { detail: 'unknown card or wrong PIN' },
      }),
    ]);
  });

  it('11 wrong PINs/min from one IP → 429', async () => {
    const h = await harness();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++)
      statuses.push((await redeemPin(h, '1234567890123456', '/card/redeem', '192.0.2.44')).status);
    expect(statuses.at(-1)).toBe(429);
  });
});
