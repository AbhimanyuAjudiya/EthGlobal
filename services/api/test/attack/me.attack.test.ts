/** AP9 — /me IDOR, enumeration, cache, degraded mode and forged entities (T-36, T-51, T-79). */
import { describe, expect, it, vi } from 'vitest';

import { type InMemoryLedger } from '@ethglobal/adapters';
import { anvilAccounts, anvilRoles } from '@ethglobal/adapters/testing';

import { errorOf, harness, iccidOf, provisioned, redeemPin, seedCard, webhook } from './fixture.js';

describe('attack: /me (AP9)', () => {
  it('cache: cached:false → cached:true → a webhook patch invalidates it', async () => {
    const h = await harness();
    const { path, key } = await provisioned(h);
    const read = async () =>
      ((await (await h.get(`/me/${path}`)).json()) as { cached: boolean }).cached;
    expect([await read(), await read()]).toEqual([false, true]);
    await webhook(h, iccidOf(h, key), 7).send();
    expect(await read()).toBe(false);
  });

  it('degraded: every write path is 503 while /me serves the cache; decide() never reads the cache', async () => {
    const h = await harness();
    const { path, key } = await provisioned(h);
    await h.get(`/me/${path}`);
    const card = await seedCard(h);
    const fresh = vi.spyOn(h.deps.cache, 'fresh');
    h.deps.health.failed();
    expect((await h.claim({ seed: 'degraded' })).res.status).toBe(503);
    expect(await errorOf(await h.json('/gift', { name: 'bob.eth', mb: 1000 }))).toBe(
      'ledger_unavailable',
    );
    expect((await redeemPin(h, card.pin)).status).toBe(503);
    expect((await webhook(h, iccidOf(h, key), 9).send()).status).toBe(503);
    expect((await h.get(`/esim/topup?key=${path}&mb=1000`)).status).toBe(503);
    expect(fresh).not.toHaveBeenCalled();
    expect(((await (await h.get(`/me/${path}`)).json()) as { degraded: boolean }).degraded).toBe(
      true,
    );
  });

  it('forged entities from another writer (T-79) are invisible: /me shows the real numbers, forged keys are 404', async () => {
    const h = await harness();
    const { path } = await provisioned(h);
    const stranger = (h.adapters.ledger as InMemoryLedger).asWriter(
      anvilAccounts[anvilRoles.stranger],
    );
    const [real] = await h.adapters.ledger.query({ annotations: { type: 'entitlement' } });
    const forged = JSON.parse(real?.payload ?? '{}') as Record<string, unknown>;
    await stranger.put({
      payload: JSON.stringify({ ...forged, mbTotal: 30_000 }),
      annotations: { ...real?.annotations },
      expiresIn: 3600,
    });
    const paidKey = `paid:${anvilAccounts[anvilRoles.stranger].toLowerCase()}:0x${'01'.repeat(32)}`;
    await stranger.put({
      payload: JSON.stringify({ ...forged, key: paidKey, kind: 'paid', mbTotal: 30_000 }),
      annotations: { ...real?.annotations, key: paidKey, kind: 'paid' },
      expiresIn: 3600,
    });
    expect(((await (await h.get(`/me/${path}`)).json()) as { mbTotal: number }).mbTotal).toBe(300);
    expect((await h.get(`/me/${encodeURIComponent(paidKey)}`)).status).toBe(404);
    expect((await h.get(`/esim/topup?key=${encodeURIComponent(paidKey)}&mb=1000`)).status).toBe(
      404,
    );
  });
});
