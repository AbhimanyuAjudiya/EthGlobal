/**
 * Red team wave 2 (unscripted): LPA secrecy along the AP6.3 pending-profile path (the retry on /me, its blob, logs,
 * metrics, receipts), the in-process state that a restart loses, and Idempotency-Key under concurrency.
 */
import { describe, expect, it, vi } from 'vitest';

import { AdapterError } from '@ethglobal/adapters';

import { harness, seedCard, type Harness } from '../support/harness.js';

const LPA_RE = /LPA:1\$/;

/** A free claim whose reseller order fails once ⇒ 202 pending-profile. */
async function pendingClaim(seed: string) {
  const h = await harness();
  vi.spyOn(h.adapters.reseller, 'order').mockRejectedValueOnce(
    new AdapterError('reseller', 'unavailable', 'down'),
  );
  const { res } = await h.claim({ seed });
  expect(res.status).toBe(202);
  return { h, body: (await res.json()) as { entitlementKey: string; sealedLpa?: unknown } };
}

/** POST /card/redeem from one IP with one Idempotency-Key. */
const redeemWithKey = async (h: Harness, pin: string, ip: string, key: string) => {
  const spk = `0x${'ef'.repeat(32)}` as const;
  const challenge = await h.challengeFor('/card/redeem', spk);
  return h.request('/card/redeem', {
    method: 'POST',
    ip,
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify({ pin, challenge, sessionPubKey: spk }),
  });
};

describe('attack: rt pending-profile LPA path (AP6.3)', () => {
  // property: whatever the retry does, no route, log line, metric or receipt ever carries an LPA in clear
  it('order fails → 202; /me retries → ready; LPA appears in no response, log, metric or receipt', async () => {
    const { h, body } = await pendingClaim('rt-pending');
    expect(body.sealedLpa).toBeUndefined();
    const path = `/me/${encodeURIComponent(body.entitlementKey)}`;
    h.clock.advance(61_000);
    const texts: string[] = [];
    for (const p of [path, `${path}?refresh=1`, `${path}/receipts`, '/metrics.json', '/plans']) {
      const r = await h.get(p);
      texts.push(await r.text());
    }
    expect(JSON.parse(texts[0]!).status).toBe('ready');
    for (const t of texts) {
      expect(t).not.toMatch(LPA_RE);
      expect(t).not.toMatch(/sealedLpa|"ephemeralPublicKey"|"ciphertext"/);
    }
    expect(h.lines.join('\n')).not.toMatch(LPA_RE);
    const dump = JSON.stringify(await h.adapters.ledger.query({}));
    expect(dump).not.toMatch(LPA_RE);
  });

  // RT-FINDING RT-A-11: the pending-profile delivery target (pendingDelivery), the T-24 intents, the treasury day
  // counter, the audit-key-shown set and the idempotency cache live only in process memory; after a restart a
  // pending-profile entitlement is never retried (retryPending returns early) — the human proved once and is stuck
  it('a pending-profile entitlement still completes after a process restart_RTFINDING', async () => {
    const { h, body } = await pendingClaim('rt-pending-restart');
    const { entitlementKey } = body;
    h.deps.pendingDelivery.clear(); // what a restart does to the in-memory map
    h.clock.advance(61_000);
    const me = (await (await h.get(`/me/${encodeURIComponent(entitlementKey)}`)).json()) as {
      status: string;
    };
    expect(me.status).toBe('ready');
  });

  // property: a non-reseller failure after sealing (blob store down) answers 5xx with no LPA anywhere
  it('blobs.put throws after sealing ⇒ 5xx, no LPA in the body or logs', async () => {
    const h = await harness();
    vi.spyOn(h.adapters.blobs, 'put').mockRejectedValueOnce(new Error('blob store down'));
    const { res } = await h.claim({ seed: 'rt-blob' });
    const text = await res.text();
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(text).not.toMatch(LPA_RE);
    expect(h.lines.join('\n')).not.toMatch(LPA_RE);
  });
});

describe('attack: rt Idempotency-Key under concurrency (AP12)', () => {
  // RT-FINDING RT-A-13: "same client + same key + different body ⇒ 409" is recorded only AFTER the
  // first response; two concurrent requests with one key and different bodies are both processed
  it('one Idempotency-Key, two different bodies, concurrently ⇒ at most one processed_RTFINDING', async () => {
    const h = await harness();
    const [a, b] = await Promise.all([seedCard(h, 300), seedCard(h, 300)]);
    const ip = '203.0.113.120';
    const withKey = (pin: string) => redeemWithKey(h, pin, ip, 'rt-same-key');
    const [ra, rb] = await Promise.all([withKey(a.pin), withKey(b.pin)]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toContain(409);
  });

  // property: sequentially, the same key with a different body is 409 and the cached body is never served
  it('control: sequential same key + different body ⇒ 409', async () => {
    const h = await harness();
    const a = await seedCard(h, 300);
    const b = await seedCard(h, 300);
    const ip = '203.0.113.121';
    const withKey = (pin: string) => redeemWithKey(h, pin, ip, 'rt-seq-key');
    expect((await withKey(a.pin)).status).toBe(201);
    const second = await withKey(b.pin);
    expect(second.status).toBe(409);
    expect(await second.text()).not.toMatch(/sealedLpa/);
  });
});
