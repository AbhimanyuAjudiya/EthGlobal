import { describe, expect, it, vi } from 'vitest';

import { ArkivLedger } from '../../src/live/arkiv-ledger.js';
import {
  anvilAccounts,
  arkivFixtureClient,
  describeLedger,
  fakeClock,
  FakeArkiv,
  T0,
} from '../../src/testing/index.js';

const WRITER = anvilAccounts[2];
const EVIL = anvilAccounts[7];

function setup(blockTimeMs = 2000) {
  const clock = fakeClock();
  const client = new FakeArkiv(clock.now, WRITER, blockTimeMs);
  const logger = { info: vi.fn(), warn: vi.fn() };
  const ledger = new ArkivLedger({ client, blockTimeMs, now: clock.now, writer: WRITER, logger });
  return { clock, client, ledger, logger };
}

describeLedger('ArkivLedger over FakeArkiv', async () => {
  const { ledger, clock } = setup();
  return { ledger, clock };
});

describe('ArkivLedger (A-23, A-24, T-35, T-79)', () => {
  it('expiration rounds up to whole 2-s blocks (604800 ⇒ fromSeconds(604800) = 302400 blocks; 601 ⇒ 602 s; 1 ⇒ 2 s)', async () => {
    const { ledger, client } = setup();
    for (const [expiresIn, seconds] of [
      [604_800, 604_800],
      [601, 602],
      [1, 2],
    ] as const) {
      await ledger.put({ payload: 'x', annotations: { type: 'receipt' }, expiresIn });
      const create = client.calls.filter((c) => c.method === 'createEntity').at(-1)!;
      expect(create.args[2]).toEqual({ expiration: { kind: 'seconds', seconds } });
    }
    expect(ledger.blocksFor(604_800)).toBe(302_400n);
    // never a btl / expiresIn key, never permissionlessExtension (T-79 f)
    expect(
      JSON.stringify(client.calls, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v)),
    ).not.toMatch(/btl|expiresIn|permissionless/i);
  });

  it('with a measured block time ≠ 2000 ms the expiry is an absolute block, rounded up', async () => {
    const { ledger, client } = setup(2500);
    await ledger.put({ payload: 'x', expiresIn: 601 });
    const create = client.calls.find((c) => c.method === 'createEntity')!;
    expect(create.args[2]).toEqual({ expiration: { kind: 'atBlock', block: 1_000_000n + 241n } });
  });

  it('expiresIn > 15768000 ⇒ invalid_request before any call', async () => {
    const { ledger, client } = setup();
    await expect(ledger.put({ payload: 'x', expiresIn: 15_768_001 })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(client.calls).toEqual([]);
    const slow = setup(4000);
    await expect(slow.ledger.put({ payload: 'x', expiresIn: 15_768_000 })).resolves.toBeDefined();
  });

  it('expiresAt derives from $expiresAt (a block) and the chain head (fixtures/arkiv/create.json)', async () => {
    const ledger = new ArkivLedger({
      client: arkivFixtureClient('arkiv/create.json'),
      blockTimeMs: 2000,
      now: () => T0,
      writer: WRITER,
    });
    await expect(
      ledger.put({ payload: 'p', annotations: { type: 'entitlement' }, expiresIn: 604_800 }),
    ).resolves.toEqual({
      key: `0x${'a1'.repeat(32)}`,
      expiresAt: T0 + 302_400 * 2000,
    });
  });

  it('get: ours ⇒ entity with numeric annotations restored; expired ⇒ null (fixtures/arkiv/{get,expired}.json)', async () => {
    const mk = (path: string) =>
      new ArkivLedger({
        client: arkivFixtureClient(path),
        blockTimeMs: 2000,
        now: () => T0,
        writer: WRITER,
      });
    const got = await mk('arkiv/get.json').get(`0x${'a1'.repeat(32)}`);
    expect(got).toMatchObject({
      payload: '{"v":1}',
      annotations: { type: 'entitlement', status: 'active' },
      expiresAt: T0 + 604_800_000,
    });
    expect(typeof got!.annotations.expiresAt).toBe('number');
    await expect(mk('arkiv/expired.json').get(`0x${'b2'.repeat(32)}`)).resolves.toBeNull();
  });

  it('every select carries $creator = our writer, and a forged row that slips through is dropped (L16, fixtures/arkiv/query.json)', async () => {
    const client = arkivFixtureClient('arkiv/query.json');
    const logger = { info: vi.fn(), warn: vi.fn() };
    const ledger = new ArkivLedger({
      client,
      blockTimeMs: 2000,
      now: () => T0,
      writer: WRITER,
      logger,
    });
    const rows = await ledger.query({
      annotations: { type: 'entitlement', key: `ent:v1:${'ab'.repeat(32)}` },
    });
    expect(rows.map((r) => r.payload)).toEqual(['{"mbTotal":300}']);
    const select = client.calls.find((c) => c.method === 'select')!;
    expect(select.args[0]).toBe('entitlement');
    expect(select.args[1]).toMatchObject({
      creator: WRITER,
      eq: { type: 'entitlement', logicalKey: `ent:v1:${'ab'.repeat(32)}` },
    });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/did not fit/));
  });

  it('a look-alike entity written by another account is invisible to get and query (T-79)', async () => {
    const { ledger, client } = setup();
    const k = `ent:v1:${'a'.repeat(64)}`;
    await ledger.put({
      payload: 'real',
      annotations: { type: 'entitlement', key: k },
      expiresIn: 60,
    });
    client.as(EVIL);
    const forged = await ledger.put({
      payload: 'forged',
      annotations: { type: 'entitlement', key: k },
      expiresIn: 60,
    });
    client.as(WRITER);
    expect((await ledger.query({ annotations: { key: k } })).map((r) => r.payload)).toEqual([
      'real',
    ]);
    await expect(ledger.get(forged.key)).resolves.toBeNull();
    await expect(ledger.update(forged.key, { payload: 'x' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('query paginates past 100 rows by $key and honours limit', async () => {
    const { ledger, client } = setup();
    for (let i = 0; i < 230; i += 1)
      await ledger.put({ payload: String(i), annotations: { type: 'nonce' }, expiresIn: 600 });
    client.calls.length = 0;
    expect(await ledger.query({ annotations: { type: 'nonce' } })).toHaveLength(230);
    const selects = client.calls.filter((c) => c.method === 'select');
    expect(selects).toHaveLength(3);
    expect((selects[1]!.args[1] as { afterKey?: string }).afterKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await ledger.query({ annotations: { type: 'nonce' }, limit: 120 })).toHaveLength(120);
    expect(await ledger.query({ annotations: { type: 'nonce' }, limit: 0 })).toEqual([]);
  });

  it('transport error ⇒ AdapterError unavailable, never null (T-20)', async () => {
    const { ledger, client } = setup();
    const { key } = await ledger.put({
      payload: 'x',
      annotations: { type: 'nonce' },
      expiresIn: 60,
    });
    client.fail = true;
    await expect(ledger.get(key)).rejects.toMatchObject({ adapter: 'ledger', code: 'unavailable' });
    await expect(ledger.query({ annotations: { type: 'nonce' } })).rejects.toMatchObject({
      code: 'unavailable',
    });
    await expect(ledger.put({ payload: 'x', expiresIn: 60 })).rejects.toMatchObject({
      code: 'unavailable',
    });
  });

  it('annotations become string/u64 attributes and back; unknown names and wrong types are refused (T-37)', async () => {
    const { ledger, client } = setup();
    const { key } = await ledger.put({
      payload: 'p',
      annotations: { type: 'receipt', key: 'rcpt:1', day: 20_395, expiresAt: T0 + 60_000 },
      expiresIn: 60,
    });
    const values = client.calls.find((c) => c.method === 'createEntity')!.args[1] as Record<
      string,
      unknown
    >;
    expect(values).toMatchObject({
      type: 'receipt',
      logicalKey: 'rcpt:1',
      day: 20_395n,
      expiresAt: BigInt(T0 + 60_000),
      createdAtMs: BigInt(T0),
    });
    expect(values.payload).toBeInstanceOf(Uint8Array);
    expect((await ledger.get(key))!.annotations).toEqual({
      type: 'receipt',
      key: 'rcpt:1',
      day: 20_395,
      expiresAt: T0 + 60_000,
    });
    for (const annotations of [
      { iccid: '8991' },
      { day: '1' },
      { key: 5 },
      { type: 'wallet' },
      { day: -1 },
    ]) {
      await expect(ledger.put({ payload: 'p', annotations, expiresIn: 60 })).rejects.toMatchObject({
        code: 'invalid_request',
      });
    }
    await expect(ledger.query({ annotations: { iccid: 'x' } })).resolves.toEqual([]);
    await expect(ledger.query({ annotations: { type: 'wallet' } })).resolves.toEqual([]);
    await expect(
      ledger.put({ payload: 'x'.repeat(128 * 1024 + 1), expiresIn: 60 }),
    ).rejects.toMatchObject({ code: 'too_large' });
  });

  it('a logical key is never fetched as an entity key (T-36)', async () => {
    const { ledger, client } = setup();
    await expect(ledger.get('ent_000001')).resolves.toBeNull();
    await expect(ledger.get(`ent:v1:${'a'.repeat(64)}`)).resolves.toBeNull();
    expect(client.calls).toEqual([]);
  });

  it('update: patch + extend, unsets removed annotations, refuses a type change, keeps a longer expiry', async () => {
    const { ledger, client, clock, logger } = setup();
    const { key } = await ledger.put({
      payload: 'a',
      annotations: { type: 'gift', key: 'g', state: 'open' },
      expiresIn: 600,
    });
    await ledger.update(key, { annotations: { type: 'gift', key: 'g' } });
    const patch = client.calls.find((c) => c.method === 'patchEntity')!;
    expect(patch.args[2]).toMatchObject({ unset: ['state'] });
    expect((patch.args[2] as { set: Record<string, unknown> }).set).toHaveProperty(
      'logicalKey',
      'g',
    );
    await expect(ledger.update(key, { annotations: { type: 'nonce' } })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    clock.advance(10_000);
    const shorter = await ledger.update(key, { payload: 'b' }, 60);
    expect(shorter.expiresAt).toBe(T0 + 600_000);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/shorter/));
    const fixture = new ArkivLedger({
      client: arkivFixtureClient('arkiv/update.json'),
      blockTimeMs: 2000,
      now: () => T0,
      writer: WRITER,
    });
    await expect(
      fixture.update(`0x${'a1'.repeat(32)}`, { payload: 'c' }, 604_800),
    ).resolves.toEqual({
      key: `0x${'a1'.repeat(32)}`,
      expiresAt: T0 + 302_400 * 2000,
    });
  });

  it('logs the implied drift once per hour and refuses to construct without a writer', async () => {
    const { ledger, logger, clock } = setup();
    await ledger.put({ payload: 'x', expiresIn: 601 });
    await ledger.put({ payload: 'x', expiresIn: 601 });
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/impliedDriftSec 1/));
    clock.advance(3_600_000);
    await ledger.put({ payload: 'x', expiresIn: 601 });
    expect(logger.info).toHaveBeenCalledTimes(2);
    const client = new FakeArkiv(clock.now, WRITER);
    expect(
      () =>
        new ArkivLedger({ client, blockTimeMs: 2000, now: clock.now, writer: '' as `0x${string}` }),
    ).toThrow(/writer/);
    expect(
      () => new ArkivLedger({ client, blockTimeMs: 0, now: clock.now, writer: WRITER }),
    ).toThrow(/blockTimeMs/);
  });
});
