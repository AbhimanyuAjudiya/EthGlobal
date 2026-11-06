/**
 * Red-team closing verification of RT-O-01 (fix in 041136f): four NEW attack variants against the fixed MeCache and
 * GET /me/:key, each kept as a passing `verify-` regression.
 *
 * (a) every key-accepting route, fed the `hk:` index read off the ledger (raw, URL-encoded, upper-cased, `hk%3A`,
 *     double-encoded, hex part alone);
 * (b) expired-vs-unknown side channel on /me: status, body, headers and timing over 200 interleaved samples;
 * (c) cache-key confusion: near-miss capabilities, label/separator ambiguity in the HMAC input, a process restart;
 * (d) ledger down after a stale-allowed entry has expired: nothing past expiry is served (d1 holds; d2 — the 60-s
 *     fresh path — fixed in cache.ts `fresh()` (expiry checked alongside the TTL); kept as a regression.
 */
import { describe, expect, it, vi } from 'vitest';

import { bytesToHex, generateSessionKeypair, hmacKey, sha256Hex, utf8 } from '@ethglobal/crypto';
import { ANN } from '@ethglobal/protocol/ids';
import type { MeResponse } from '@ethglobal/protocol/schemas';

import { MeCache } from '../../src/cache.js';
import { agentPolicyPut } from '../support/client.js';
import { harness, HUMAN_KEY, provisioned, STRANGER_KEY, type Harness } from '../support/harness.js';

const POLICY = {
  maxUsd6PerDay: '2000000',
  thresholdMb: 50,
  stepMb: 100,
  paused: false,
  topUpOnExpiry: true,
  expiryLeadS: 3600,
};

/** What any Arkiv reader sees: the `key` annotation and `payload.key` of every entitlement entity. */
async function ledgerIndexes(h: Harness): Promise<string[]> {
  const rows = await h.adapters.ledger.query({
    annotations: { [ANN.type]: 'entitlement' },
    limit: 100,
  });
  const seen = new Set<string>();
  for (const row of rows) {
    seen.add(String(row.annotations[ANN.key]));
    seen.add((JSON.parse(row.payload) as { key: string }).key);
  }
  return [...seen];
}

/** The index forms an attacker would try for one ledger-read `hk:<hex>` value. */
function indexForms(index: string): string[] {
  const hex = index.slice(3);
  return [
    index,
    encodeURIComponent(index),
    index.toUpperCase(),
    `HK:${hex}`,
    `Hk:${hex}`,
    `hk%3A${hex}`,
    `hk%3a${hex}`,
    `hk%253A${hex}`,
    `%68%6b%3a${hex}`,
    hex,
    `0x${hex}`,
    ` hk:${hex}`.trim(),
  ];
}

const bodyText = async (r: Response): Promise<string> => r.clone().text();
const errorCode = async (r: Response): Promise<string | undefined> =>
  ((await r.clone().json()) as { error?: string }).error;

describe('verify RT-O-01 (closing variants): a ledger-read index opens nothing, anywhere', () => {
  it('(a) every key-accepting route refuses the ledger-read index in every encoding [RT-O-01]', async () => {
    const h = await harness();
    const victim = await provisioned(h, 'verify-o01-routes');
    const key = victim.key;
    // the victim's PWA reads /me first, so the cache is primed for the capability
    expect((await h.get(`/me/${victim.path}`)).status).toBe(200);

    const indexes = (await ledgerIndexes(h)).filter((v) => v.startsWith('hk:'));
    expect(indexes).toContain(`hk:${sha256Hex(utf8(key))}`);
    // nothing on the ledger is the capability itself
    expect(JSON.stringify(await h.adapters.ledger.query({}))).not.toContain(key);

    for (const index of indexes) {
      for (const form of indexForms(index)) {
        const leaks: Response[] = [];
        // /me/:key and its fresh-cache and refresh paths
        for (const path of [`/me/${form}`, `/me/${form}?refresh=1`]) {
          const r = await h.get(path);
          expect(r.status, path).toBe(404);
          leaks.push(r);
        }
        // /me/:key/receipts: never the victim's receipts
        const receipts = await h.get(`/me/${form}/receipts`);
        if (receipts.status === 200)
          expect(((await receipts.clone().json()) as { receipts: unknown[] }).receipts).toEqual([]);
        leaks.push(receipts);
        // /esim/topup?key=: no 402 offer is ever minted for the index (it is not a live entitlement)
        const topup = await h.get(`/esim/topup?key=${form}&mb=1000`);
        expect([400, 404], `topup ${form}`).toContain(topup.status);
        expect(topup.headers.get('PAYMENT-REQUIRED')).toBeNull();
        leaks.push(topup);
        // GET /agent/policy/:key: nothing registered under an index
        const policyGet = await h.get(`/agent/policy/${form}`);
        expect(policyGet.status).toBe(404);
        leaks.push(policyGet);
        for (const r of leaks) expect(await bodyText(r)).not.toContain(key);
      }
      // PUT /agent/policy with the raw index as entitlementKey, validly signed by a stranger and by the payer
      for (const signer of [STRANGER_KEY, HUMAN_KEY]) {
        const put = await h.json(
          '/agent/policy',
          await agentPolicyPut(signer, h.deps.chainId, index, POLICY, h.clock.now()),
          {},
          'PUT',
        );
        expect([400, 404]).toContain(put.status);
        expect(await bodyText(put)).not.toContain(key);
      }
      // /gift/claim and /card/redeem: the index (and its hex as a giftId) is no gift and no PIN
      const hex = `0x${index.slice(3)}`;
      for (const [path, body] of [
        [
          '/gift/claim',
          { giftId: hex, signature: `0x${'11'.repeat(65)}`, recipient: `0x${'22'.repeat(20)}` },
        ],
        ['/gift/claim', { pin: index }],
        ['/card/redeem', { pin: index }],
        ['/card/redeem', { pin: index.slice(3, 15) }],
      ] as const) {
        const spk = bytesToHex(generateSessionKeypair().publicKey);
        const challenge = await h.challengeFor(path, spk);
        const r = await h.json(path, { ...body, challenge, sessionPubKey: spk });
        expect(r.status, `${path} ${JSON.stringify(body)}`).toBeGreaterThanOrEqual(400);
        expect(r.status).toBeLessThan(500);
        expect(await bodyText(r)).not.toContain(key);
        expect(await bodyText(r)).not.toContain('sealedLpa');
      }
    }
    // control: the victim still holds a working capability
    expect((await h.get(`/me/${victim.path}`)).status).toBe(200);
  });

  it('(b) expired and unknown keys on /me are indistinguishable: status, body, headers, 200-sample timing [RT-O-01]', async () => {
    const h = await harness();
    const victim = await provisioned(h, 'verify-o01-timing');
    const me = (await (await h.get(`/me/${victim.path}`)).json()) as MeResponse;
    // just past expiry: the ledger may still hold the row (lifetime rounded up), so the store parses and drops it
    h.clock.set(me.expiresAt + 1);
    const forged = `ent:v1:0x${'ab'.repeat(32)}`;
    const forms = {
      expired: `/me/${victim.path}`,
      unknown: `/me/${encodeURIComponent(forged)}`,
    };
    const shape = async (r: Response) => {
      const headers = [...r.headers.entries()]
        .filter(([k]) => k !== 'x-request-id' && k !== 'date')
        .sort(([a], [b]) => a.localeCompare(b));
      const body = (await r.json()) as Record<string, unknown>;
      expect(body.requestId).toBe(r.headers.get('x-request-id'));
      return { status: r.status, headers, body: { ...body, requestId: undefined } };
    };
    const reference = {
      expired: await shape(await h.get(forms.expired)),
      unknown: await shape(await h.get(forms.unknown)),
    };
    expect(reference.expired.status).toBe(404);
    expect(reference.expired).toEqual(reference.unknown);

    // after the ledger has dropped the row as well (the steady state)
    h.clock.advance(86_400_000);
    expect(await shape(await h.get(forms.expired))).toEqual(reference.unknown);
    h.clock.set(me.expiresAt + 1);

    const SAMPLES = 200;
    const times: Record<'expired' | 'unknown', number[]> = { expired: [], unknown: [] };
    const sizes: Record<'expired' | 'unknown', Set<number>> = {
      expired: new Set(),
      unknown: new Set(),
    };
    // warm-up, then interleave so GC and JIT drift hits both arms equally
    for (let i = 0; i < 20; i++) await h.get(i % 2 ? forms.expired : forms.unknown);
    for (let i = 0; i < SAMPLES * 2; i++) {
      const arm: 'expired' | 'unknown' = (i & 1) === ((i >> 1) & 1) ? 'expired' : 'unknown';
      const t0 = performance.now();
      const r = await h.get(forms[arm]);
      const text = await r.text();
      times[arm].push(performance.now() - t0);
      expect(r.status).toBe(404);
      sizes[arm].add(text.length);
      expect(r.headers.get('content-length') ?? String(text.length)).toBe(String(text.length));
    }
    expect([...sizes.expired]).toEqual([...sizes.unknown]);
    expect(sizes.expired.size).toBe(1);
    // best threshold classifier over the pooled samples: an observer must not beat a coin by a useful margin
    const all = [
      ...times.expired.map((t) => [t, 1] as const),
      ...times.unknown.map((t) => [t, 0] as const),
    ].sort((a, b) => a[0] - b[0]);
    let best = 0.5;
    let below1 = 0;
    let below0 = 0;
    for (const [, label] of all) {
      if (label) below1++;
      else below0++;
      const acc = (below1 + (SAMPLES - below0)) / (2 * SAMPLES);
      best = Math.max(best, acc, 1 - acc);
    }
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;
    const gap = Math.abs(median(times.expired) - median(times.unknown));
    console.info(
      `RT-O-01 (b): median expired ${median(times.expired).toFixed(3)} ms, unknown ${median(times.unknown).toFixed(3)} ms, best classifier ${(best * 100).toFixed(1)} %`,
    );
    // in-process (no network jitter at all) the medians differ by less than 0.25 ms and no threshold separates them
    expect(gap).toBeLessThan(0.25);
    expect(best).toBeLessThan(0.7);
  });

  it('(c) no cache-key confusion: near-miss capabilities, HMAC label/separator ambiguity, process restart [RT-O-01]', async () => {
    const h = await harness();
    const victim = await provisioned(h, 'verify-o01-confusion');
    const key = victim.key;
    expect((await h.get(`/me/${victim.path}`)).status).toBe(200);
    // near-miss capabilities never hit the victim's slot (case, prefix, suffix, label-shifted, double-encoded)
    const nearMisses = [
      key.toUpperCase(),
      key.slice(0, -1),
      `${key}0`,
      `mecache${key}`,
      key.replace(/^ent:/, 'ent%3A'),
      encodeURIComponent(encodeURIComponent(key)),
      key.replace(/^ent:v1:/, 'ent:v1:mecache'),
    ].filter((k) => k !== key);
    for (const k of nearMisses) {
      const r = await h.get(`/me/${encodeURIComponent(k)}`);
      expect(r.status, k).toBe(404);
      expect(await bodyText(r)).not.toContain(key);
    }
    // the HMAC input is a fixed label ‖ capability: a capability can only collide with itself
    const secret = new Uint8Array(32).fill(9);
    expect(hmacKey(secret, 'mecache', 'ent:v1:x')).toBe(hmacKey(secret, 'mecache', 'ent', ':v1:x'));
    const cache = new MeCache(h.clock.now);
    const meOf = (k: string) =>
      ({ entitlementKey: k, expiresAt: h.clock.now() + 3_600_000 }) as MeResponse;
    cache.remember('ent:v1:aaaa', meOf('ent:v1:aaaa'), { staleAllowed: true });
    for (const k of [
      'ent:v1:aaa',
      'ent:v1:aaaaa',
      'Ent:v1:aaaa',
      'ent:v1:aaaa\u0000',
      'cacheent:v1:aaaa',
    ]) {
      expect(cache.fresh(k), k).toBeUndefined();
      expect(cache.stale(k), k).toBeUndefined();
      expect(cache.expired(k), k).toBe(false);
    }
    // the index of the remembered capability opens nothing, and invalidation by index still lands
    const index = `hk:${sha256Hex(utf8('ent:v1:aaaa'))}`;
    expect([cache.fresh(index), cache.stale(index)]).toEqual([undefined, undefined]);
    cache.remember(index, meOf(index), { staleAllowed: true });
    expect([cache.fresh(index), cache.stale(index)]).toEqual([undefined, undefined]);
    cache.invalidate(index);
    expect(cache.fresh('ent:v1:aaaa')).toBeUndefined();
    // two processes: an entry remembered by one is invisible to the other (fresh per-process secret)
    const a = new MeCache(h.clock.now);
    const b = new MeCache(h.clock.now);
    a.remember(key, meOf(key), { staleAllowed: true });
    expect([b.fresh(key), b.stale(key), b.expired(key)]).toEqual([undefined, undefined, false]);

    // a real restart: the old process primed its cache, the new one comes up while the ledger is down
    const next = await h.restart();
    const spy = vi.spyOn(h.adapters.ledger, 'query').mockRejectedValue(new Error('arkiv down'));
    const owner = await next.app.request(`/me/${victim.path}`, {
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });
    const thief = await next.app.request(
      `/me/${encodeURIComponent(`hk:${sha256Hex(utf8(key))}`)}`,
      {
        headers: { 'x-forwarded-for': '203.0.113.8' },
      },
    );
    spy.mockRestore();
    expect(owner.status).toBe(503); // fail closed: nothing carried over from the old process
    expect(thief.status).toBe(404);
    expect(await bodyText(owner)).not.toContain(key);
    expect(await bodyText(thief)).not.toContain(key);
  });

  it('(d1) ledger down after a stale-allowed entry expired: the stale path serves nothing past expiry, by any form [RT-O-01]', async () => {
    const h = await harness();
    const victim = await provisioned(h, 'verify-o01-down');
    const key = victim.key;
    const me = (await (await h.get(`/me/${victim.path}`)).json()) as MeResponse;
    expect(['ready', 'installed', 'active']).toContain(me.status); // remembered with staleAllowed
    const index = encodeURIComponent(`hk:${sha256Hex(utf8(key))}`);
    const spy = vi.spyOn(h.adapters.ledger, 'query').mockRejectedValue(new Error('arkiv down'));

    // control: before expiry the stale-allowed copy IS served while degraded (T-51 still works)
    h.clock.set(me.expiresAt - 120_000);
    const before = await h.get(`/me/${victim.path}`);
    expect(before.status).toBe(200);
    expect((await before.json()) as MeResponse).toMatchObject({ cached: true, degraded: true });

    for (const at of [
      me.expiresAt,
      me.expiresAt + 1,
      me.expiresAt + 60_000,
      me.expiresAt + 8 * 86_400_000,
    ]) {
      h.clock.set(at);
      for (const path of [`/me/${victim.path}`, `/me/${index}`, `/me/${victim.path}?refresh=1`]) {
        const r = await h.get(path);
        expect(r.status, `${path} @+${at - me.expiresAt}`).not.toBe(200);
        expect(await bodyText(r)).not.toContain(key);
      }
    }
    spy.mockRestore();
  });

  // Regression RT-O-01 variant d2: MeCache.fresh() must compare the entry's expiresAt with
  // now, and GET /me/:key consults fresh() before the ledger. An entry remembered < 60 s before expiry is served as a
  // 200 (status still 'ready') for up to 60 s AFTER expiry — with the ledger down or up — while the same key read
  // from the ledger is the 404 of an unknown key. Fix: `fresh()` must also require `hit.me.expiresAt > now()`.
  it('(d2) a fresh (<60 s) cache entry is never served past the entitlement expiry, ledger down or up [RT-O-01 d2]', async () => {
    const h = await harness();
    const victim = await provisioned(h, 'verify-o01-fresh');
    const me = (await (await h.get(`/me/${victim.path}`)).json()) as MeResponse;
    const served: string[] = [];
    for (const ledgerDown of [true, false]) {
      // re-read 30 s before expiry (the PWA polls), then cross the expiry inside the 60-s TTL
      h.clock.set(me.expiresAt - 30_000);
      expect((await h.get(`/me/${victim.path}?refresh=1`)).status).toBe(200);
      const spy = ledgerDown
        ? vi.spyOn(h.adapters.ledger, 'query').mockRejectedValue(new Error('arkiv down'))
        : undefined;
      h.clock.set(me.expiresAt + 1);
      const r = await h.get(`/me/${victim.path}`);
      spy?.mockRestore();
      if (r.status === 200) {
        const body = (await r.json()) as MeResponse;
        served.push(
          `ledger ${ledgerDown ? 'down' : 'up'}: 200 status=${body.status} expiresAt ≤ now`,
        );
      } else {
        expect(await errorCode(r)).toBeDefined();
      }
      h.clock.set(me.expiresAt - 30_000); // reset for the next arm (the entitlement is still live here)
    }
    expect(served).toEqual([]);
  });

  // Closing pass 2 (after b3d0c35): the exact boundary of the d2 fix. `expiresAt` itself is already dead (T-35:
  // live only while expiresAt > now), so an entry remembered 1 ms before must not answer AT expiresAt.
  it('(e) remembered 1 ms before expiry, read at exactly expiresAt: plain, ?refresh=1, receipts, index; ledger up and down [RT-O-01 e]', async () => {
    const h = await harness();
    const victim = await provisioned(h, 'verify-o01-boundary');
    const key = victim.key;
    const index = encodeURIComponent(`hk:${sha256Hex(utf8(key))}`);
    const me = (await (await h.get(`/me/${victim.path}`)).json()) as MeResponse;
    const unknown = await h.get(`/me/${encodeURIComponent(`ent:v1:0x${'cd'.repeat(32)}`)}`);
    const unknownBody = { ...((await unknown.json()) as object), requestId: undefined };
    const ownReceipts = (
      (await (await h.get(`/me/${victim.path}/receipts`)).json()) as {
        receipts: unknown[];
      }
    ).receipts;
    for (const ledgerDown of [false, true]) {
      // prime both caches (fresh + staleAllowed) 1 ms before expiry
      h.clock.set(me.expiresAt - 1);
      const primed = await h.get(`/me/${victim.path}?refresh=1`);
      expect(primed.status).toBe(200);
      expect(((await primed.json()) as MeResponse).expiresAt).toBe(me.expiresAt);
      const spy = ledgerDown
        ? vi.spyOn(h.adapters.ledger, 'query').mockRejectedValue(new Error('arkiv down'))
        : undefined;
      h.clock.set(me.expiresAt);
      const arm = `ledger ${ledgerDown ? 'down' : 'up'}`;
      for (const path of [
        `/me/${victim.path}`,
        `/me/${victim.path}?refresh=1`,
        `/me/${index}`,
        `/me/${index}?refresh=1`,
      ]) {
        const r = await h.get(path);
        expect(r.status, `${arm} ${path}`).not.toBe(200);
        expect(await bodyText(r)).not.toContain(key);
        if (!ledgerDown) {
          // ledger up: byte-identical to an unknown key (no boundary oracle)
          expect(r.status).toBe(404);
          expect({ ...((await r.json()) as object), requestId: undefined }).toEqual(unknownBody);
        } else if (path.includes('hk%3A')) {
          expect(r.status).toBe(404); // the index is refused before any cache or ledger
        } else {
          expect(r.status).toBe(503); // capability: fail closed, never the remembered copy
        }
      }
      // receipts: the index opens none; the capability's own history carries neither the key nor its hash
      const byIndex = await h.get(`/me/${index}/receipts`);
      if (byIndex.status === 200)
        expect(((await byIndex.json()) as { receipts: unknown[] }).receipts).toEqual([]);
      const byKey = await h.get(`/me/${victim.path}/receipts`);
      const text = await bodyText(byKey);
      expect(text).not.toContain(key);
      expect(text).not.toContain(sha256Hex(utf8(key)).slice(2));
      if (!ledgerDown && byKey.status === 200)
        expect(((await byKey.json()) as { receipts: unknown[] }).receipts).toHaveLength(
          ownReceipts.length,
        );
      spy?.mockRestore();
    }
    // 1 ms earlier the copy is still served (the boundary is exact, not over-broad)
    h.clock.set(me.expiresAt - 2);
    expect((await h.get(`/me/${victim.path}?refresh=1`)).status).toBe(200);
    h.clock.set(me.expiresAt - 1);
    const live = await h.get(`/me/${victim.path}`);
    expect(live.status).toBe(200);
    expect(((await live.json()) as MeResponse).cached).toBe(true);
  });
});
