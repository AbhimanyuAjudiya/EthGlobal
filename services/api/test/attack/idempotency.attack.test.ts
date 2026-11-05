/**
 * AP12 — Idempotency-Key collisions (T-74, N9). Scope (middleware/idempotency.ts):
 * sha256(route ‖ Idempotency-Key ‖ clientIp ‖ sha256(rawBody) ‖ sha256(PAYMENT-SIGNATURE)); 2xx only; once-only bodies 300 s.
 */
import { describe, expect, it, vi } from 'vitest';

import { harness, seedCard, type Harness } from './fixture.js';

const gift = (h: Harness, ip: string, headers: Record<string, string>, name = 'bob.eth') =>
  h.request('/gift', {
    method: 'POST',
    ip,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ name, mb: 100 }),
  });

describe('attack: Idempotency-Key (AP12)', () => {
  it('client B with client A’s key gets its own 402, never A’s cached 201 with A’s PIN', async () => {
    const h = await harness();
    const quote = await gift(h, '192.0.2.1', {});
    const pay = await h.payFor(quote);
    const a = await gift(h, '192.0.2.1', { 'idempotency-key': 'k-1', ...pay });
    expect(a.status).toBe(201);
    const b = await gift(h, '192.0.2.2', { 'idempotency-key': 'k-1' }, 'alice.eth');
    expect(b.status).toBe(402);
    expect(await b.text()).not.toContain(((await a.json()) as { pin: string }).pin);
  });

  it('same client, same key, same body ⇒ the cached response; same key, different body ⇒ 409', async () => {
    const h = await harness();
    const pay = await h.payFor(await gift(h, '192.0.2.3', {}));
    const first = await gift(h, '192.0.2.3', { 'idempotency-key': 'k-2', ...pay });
    const again = await gift(h, '192.0.2.3', { 'idempotency-key': 'k-2', ...pay });
    expect([first.status, again.status]).toEqual([201, 201]);
    expect(await again.text()).toBe(await first.text());
    expect(again.headers.get('PAYMENT-RESPONSE')).toBe(first.headers.get('PAYMENT-RESPONSE'));
    expect((await gift(h, '192.0.2.3', { 'idempotency-key': 'k-2' }, 'alice.eth')).status).toBe(
      409,
    );
  });

  it('an in-flight duplicate ⇒ 409 replay; exactly one reseller order', async () => {
    const h = await harness();
    const card = await seedCard(h);
    const order = vi.spyOn(h.reseller, 'order');
    const body = await (async () => {
      const { bytesToHex, generateSessionKeypair } = await import('@ethglobal/crypto');
      const spk = bytesToHex(generateSessionKeypair().publicKey);
      return JSON.stringify({
        pin: card.pin,
        challenge: await h.challengeFor('/card/redeem', spk),
        sessionPubKey: spk,
      });
    })();
    const send = () =>
      h.request('/card/redeem', {
        method: 'POST',
        ip: '192.0.2.4',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'k-3' },
        body,
      });
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(order).toHaveBeenCalledTimes(1);
  });

  it('a cached sealedLpa is not replayed after 300 s', async () => {
    const h = await harness();
    const card = await seedCard(h);
    const { bytesToHex, generateSessionKeypair } = await import('@ethglobal/crypto');
    const spk = bytesToHex(generateSessionKeypair().publicKey);
    const body = JSON.stringify({
      pin: card.pin,
      challenge: await h.challengeFor('/card/redeem', spk),
      sessionPubKey: spk,
    });
    const send = () =>
      h.request('/card/redeem', {
        method: 'POST',
        ip: '192.0.2.5',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'k-4' },
        body,
      });
    expect((await send()).status).toBe(201);
    expect(await (await send()).text()).toMatch(/sealedLpa/);
    h.clock.advance(301_000);
    const late = await send();
    expect(late.status).not.toBe(201);
    expect(await late.text()).not.toMatch(/sealedLpa/);
  });
});
