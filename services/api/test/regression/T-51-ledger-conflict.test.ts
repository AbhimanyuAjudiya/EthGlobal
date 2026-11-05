/**
 * T-51 (ops regression): a lost create-if-absent / compare-and-swap (`AdapterError('ledger','conflict')`, A-32) is the
 * ledger answering, not failing — it must not mark the API degraded, or a normal replay 503s the next write.
 */
import { describe, expect, it } from 'vitest';

import { AdapterError, type Ledger } from '@ethglobal/adapters';

import { LedgerHealth, observedLedger } from '../../src/cache.js';
import { harness, iccidOf, provisioned, topUp, webhook } from '../support/harness.js';

describe('T-51 ledger conflict is not an outage', () => {
  it('observedLedger: conflict ⇒ rethrown, counted ok, not degraded; any other throw ⇒ degraded', async () => {
    let failWith: unknown = new AdapterError('ledger', 'conflict', 'lost the race');
    const raw: Ledger = {
      put: async () => {
        throw failWith;
      },
      get: async () => null,
      query: async () => [],
      update: async () => {
        throw failWith;
      },
    };
    let now = 0;
    const health = new LedgerHealth(() => now);
    const seen: boolean[] = [];
    const ledger = observedLedger(raw, health, (_op, _ms, ok) => void seen.push(ok));
    await expect(ledger.put({} as never)).rejects.toMatchObject({ code: 'conflict' });
    await expect(ledger.update('k', {})).rejects.toMatchObject({ code: 'conflict' });
    expect(health.degraded).toBe(false);
    expect(seen).toEqual([true, true]);
    failWith = new Error('arkiv down');
    await expect(ledger.put({} as never)).rejects.toMatchObject({ code: 'unavailable' });
    expect(health.degraded).toBe(true);
    now += 60_001;
    expect(health.degraded).toBe(false);
  });

  it('a replayed payment (front-run recovery hands back the executed transfer ⇒ settlement-marker conflict) does not 503 the next webhook or write', async () => {
    const h = await harness();
    const p = await provisioned(h, 't51-replay');
    await h.get(`/me/${p.path}`);
    const iccid = iccidOf(h, p.key);
    const { paid, pay, path } = await topUp(h, p.key);
    expect(paid.status).toBe(200);
    const settled = ((await paid.json()) as { settlement: unknown }).settlement;
    // what the self-run facilitator does for a replay: verify says nonce_already_used, settle recovers the transfer
    const rail = h.adapters.payments;
    const verify = rail.verify.bind(rail);
    rail.verify = async () => ({ isValid: false, invalidReason: 'nonce_already_used' });
    rail.settle = async () => settled as Awaited<ReturnType<typeof rail.settle>>;
    const replay = await h.get(path, pay);
    expect(replay.status).not.toBe(200); // served once (the A-33 settlement marker)
    rail.verify = verify;
    expect(h.deps.health.degraded).toBe(false);
    expect((await webhook(h, iccid, 60).send()).status).toBe(204);
    expect((await h.claim({ seed: 't51-next' })).res.status).toBe(201);
  });
});
