import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import { paymentPayloadSchema, paymentRequirementsSchema } from '@ethglobal/protocol/schemas';

import {
  anvilAccounts,
  anvilKeys,
  anvilRoles,
  fakeClock,
  hardhatExtraAccounts,
  isPublicDevAccount,
  publicDevAccounts,
  fixtureFetch,
  FixtureMiss,
  loadFixture,
  paymentPayload,
  requirementInput,
  T0,
} from '../../src/testing/index.js';

const REC = 'testing/fixture-fetch-example.json';

describe('clock and anvil', () => {
  it('T0 and fakeClock', () => {
    expect(T0).toBe(Date.UTC(2026, 10, 3, 12));
    const clock = fakeClock();
    clock.advance(1_000);
    expect(clock.now()).toBe(T0 + 1_000);
    clock.set(5);
    expect(clock.now()).toBe(5);
    expect(fakeClock(42).now()).toBe(42);
  });

  it('ten Anvil keys derive the ten Anvil accounts; roles index into them', () => {
    expect(anvilKeys).toHaveLength(10);
    anvilKeys.forEach((key, i) => expect(privateKeyToAccount(key).address).toBe(anvilAccounts[i]));
    expect(Object.values(anvilRoles).every((i) => i >= 0 && i < 10)).toBe(true);
    expect(new Set(Object.values(anvilRoles)).size).toBe(Object.keys(anvilRoles).length);
  });

  it('publicDevAccounts = the 20 accounts Anvil/Hardhat derive from the public mnemonic (RT-G-04)', () => {
    const mnemonic = 'test test test test test test test test test test test junk';
    const derived = Array.from(
      { length: 20 },
      (_, i) => mnemonicToAccount(mnemonic, { addressIndex: i }).address,
    );
    expect(publicDevAccounts).toEqual(derived);
    expect(hardhatExtraAccounts).toEqual(derived.slice(10));
    expect(derived.every((a) => isPublicDevAccount(a.toLowerCase()))).toBe(true);
    expect(isPublicDevAccount(`0x${'12'.repeat(20)}`)).toBe(false);
  });
});

describe('fixtures', () => {
  it('loadFixture reads <repo>/fixtures and refuses to escape it', () => {
    expect(loadFixture<{ name: string }>(REC).name).toBe('fixtureFetch self-test');
    expect(() => loadFixture('../package.json')).toThrow(/escapes fixtures/);
  });

  it('fixtureFetch matches path + sorted query regardless of host, in recorded order, then repeats the last', async () => {
    const f = fixtureFetch(REC);
    const read = async (url: string) =>
      ((await (await f(url)).json()) as { usedMb: number }).usedMb;
    expect(await read('http://other.host/v1/usage?a=1&b=2&iccid=8991')).toBe(10);
    expect(await read('https://api.example.test/v1/usage?iccid=8991&a=1&b=2')).toBe(20);
    expect(await read('https://api.example.test/v1/usage?b=2&a=1&iccid=8991')).toBe(20);
  });

  it('replays status, headers and bodies (JSON, text, empty)', async () => {
    const f = fixtureFetch(REC);
    const order = await f('https://api.example.test/v1/order', {
      method: 'POST',
      body: '{"count":1,"plan":"IN-1GB"}',
    });
    expect([order.status, order.headers.get('x-order'), order.headers.get('content-type')]).toEqual(
      [201, 'o1', 'application/json'],
    );
    expect(await order.json()).toEqual({ orderId: 'o1' });
    const ping = await f(new Request('https://api.example.test/v1/ping', { method: 'POST' }));
    expect([ping.status, await ping.text()]).toEqual([204, '']);
    const text = await f('https://api.example.test/v1/text');
    expect([text.status, await text.text()]).toEqual([503, 'busy']);
  });

  it('strictBody compares canonical JSON bodies', async () => {
    const f = fixtureFetch(REC, { strictBody: true });
    await expect(
      f('https://api.example.test/v1/order', {
        method: 'POST',
        body: '{"plan":"IN-1GB","count":1}',
      }),
    ).resolves.toHaveProperty('status', 201);
    await expect(
      f('https://api.example.test/v1/order', {
        method: 'POST',
        body: '{"plan":"IN-2GB","count":1}',
      }),
    ).rejects.toBeInstanceOf(FixtureMiss);
  });

  it('throws FixtureMiss carrying method, url and body on an unmatched request', async () => {
    const f = fixtureFetch(REC);
    const miss = await f('https://api.example.test/v1/usage?iccid=1', {
      method: 'DELETE',
      body: 'x',
    }).catch((e: unknown) => e);
    expect(miss).toBeInstanceOf(FixtureMiss);
    expect(miss).toMatchObject({
      code: 'fixture_miss',
      request: { method: 'DELETE', url: 'https://api.example.test/v1/usage?iccid=1', body: 'x' },
    });
  });
});

describe('builders', () => {
  it('requirementInput and paymentPayload produce schema-valid wire objects', () => {
    const input = requirementInput({ amount: '1200000' });
    const req = { scheme: 'exact' as const, maxTimeoutSeconds: 300, ...input };
    const { resource: _resource, ...requirements } = req;
    expect(paymentRequirementsSchema.safeParse(requirements).success).toBe(true);
    const payload = paymentPayload(requirements, { nonce: `0x${'aa'.repeat(32)}` });
    expect(paymentPayloadSchema.safeParse(payload).success).toBe(true);
    expect(payload.payload).toMatchObject({
      authorization: { value: '1200000', nonce: `0x${'aa'.repeat(32)}`, to: input.payTo },
    });
  });
});
