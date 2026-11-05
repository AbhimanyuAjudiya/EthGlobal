import * as standardsSdk from '@hashgraphonline/standards-sdk';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { describe, expect, it, vi } from 'vitest';

import { EnsResolver, type EnsClient } from '../../src/live/ens-resolver.js';
import { consensusMs, HcsLog } from '../../src/live/hcs-log.js';
import { base58, hcs14Uaid } from '../../src/live/hcs14.js';
import { SwarmBlobStore } from '../../src/live/swarm-blobs.js';
import {
  describeBlobStore,
  describeConsensusLog,
  describeNameResolver,
  fixtureFetch,
  loadFixture,
  NAME_FIXTURE,
  T0,
} from '../../src/testing/index.js';

import type { HederaClientLike } from '../../src/live/hedera-sdk.js';

/** createUaid is exported at runtime but missing from the package's es typings (0.1.192). */
const { createUaid } = standardsSdk as unknown as {
  createUaid: (input: object, params: { proto: string }) => Promise<string>;
};

/** A fake Hedera network whose mirror serves what was submitted, in the documented REST shape. */
function fakeHedera() {
  const topics = new Map<string, { message: string; at: number }[]>();
  const client: HederaClientLike = {
    submitTopicMessage: async (topic, message) => {
      const log = topics.get(topic) ?? [];
      topics.set(topic, log);
      log.push({ message, at: T0 + log.length * 1000 });
      return {
        sequence: log.length,
        consensusAt: T0 + (log.length - 1) * 1000,
        txId: `0.0.6006@1793707200.00000000${log.length}`,
      };
    },
    transferToken: vi.fn(),
    tokenBalance: vi.fn(),
  };
  const mirror: typeof fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const topic = /topics\/([^/]+)\/messages/.exec(url.pathname)![1]!;
    const from = Number(url.searchParams.get('sequencenumber')!.replace('gte:', ''));
    const log = topics.get(topic);
    if (!log) return new Response('{"_status":{}}', { status: 404 });
    const messages = log
      .map((m, i) => ({
        sequence_number: i + 1,
        message: Buffer.from(m.message).toString('base64'),
        consensus_timestamp: `${m.at / 1000}.000000000`,
      }))
      .filter((m) => m.sequence_number >= from);
    return new Response(JSON.stringify({ messages, links: { next: null } }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  return { client, mirror };
}

describeConsensusLog('HcsLog over a fake Hedera client + mirror', async () => {
  const { client, mirror } = fakeHedera();
  return new HcsLog({ client, mirrorUrl: 'https://testnet.mirrornode.hedera.com', fetch: mirror });
});

describe('HcsLog (A-22, T-44)', () => {
  it('reads the recorded mirror pages (fixtures/hcs/mirror-messages.json), following links.next on the same host', async () => {
    const log = new HcsLog({
      client: fakeHedera().client,
      mirrorUrl: 'https://testnet.mirrornode.hedera.com',
      fetch: fixtureFetch('hcs/mirror-messages.json'),
    });
    const messages = await log.read('0.0.4242');
    expect(messages).toEqual([
      { sequence: 1, message: '{"v":1,"n":1}', consensusAt: 1793707201000 },
      { sequence: 2, message: '{"v":1,"n":2}', consensusAt: 1793707202000 },
      { sequence: 3, message: '{"v":1,"n":3}', consensusAt: 1793707203000 },
    ]);
    await expect(log.read('0.0.9999')).resolves.toEqual([]);
    await expect(log.read('0.0.7777')).rejects.toMatchObject({
      adapter: 'consensus',
      code: 'invalid_response',
    });
    await expect(log.read('not-a-topic')).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('> 1024 bytes rejected before submit (L12); SDK errors ⇒ unavailable', async () => {
    const submit = vi.fn().mockRejectedValue(new Error('INVALID_SIGNATURE'));
    const log = new HcsLog({
      client: { submitTopicMessage: submit, transferToken: vi.fn(), tokenBalance: vi.fn() },
      mirrorUrl: 'https://testnet.mirrornode.hedera.com',
    });
    await expect(log.submit('0.0.1', 'x'.repeat(1025))).rejects.toMatchObject({
      code: 'too_large',
    });
    expect(submit).not.toHaveBeenCalled();
    await expect(log.submit('0.0.1', 'x')).rejects.toMatchObject({ code: 'unavailable' });
    const down = new HcsLog({
      client: fakeHedera().client,
      mirrorUrl: 'https://testnet.mirrornode.hedera.com',
      fetch: () => Promise.reject(new TypeError('x')),
    });
    await expect(down.read('0.0.1')).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('consensus timestamps: seconds.nanos → ms', () => {
    expect(consensusMs('1793707200.123456789')).toBe(1793707200123);
    expect(consensusMs('1793707200')).toBe(1793707200000);
    expect(consensusMs('1.5')).toBe(1500);
  });

  it('hcs14Uaid matches the recorded vector and @hashgraphonline/standards-sdk createUaid (A-29)', async () => {
    const vector = loadFixture<{ input: Parameters<typeof hcs14Uaid>[0]; uaid: string }>(
      'hcs/hcs14-vector.json',
    );
    expect(hcs14Uaid(vector.input)).toBe(vector.uaid);
    const input = { ...vector.input, name: '  Recharge Agent ', skills: [9, 0, 4] };
    const theirs = await createUaid({ ...input, skills: [...input.skills] }, { proto: 'x402' });
    expect(hcs14Uaid(input)).toBe(theirs);
    expect(hcs14Uaid({ ...vector.input, skills: [] })).toBe(
      await createUaid({ ...vector.input, skills: [] }, { proto: 'x402' }),
    );
    expect(() => hcs14Uaid({ ...vector.input, nativeId: '0.0.6006' })).toThrow(/CAIP-10/);
    expect(() => hcs14Uaid({ ...vector.input, skills: [1.5] })).toThrow(/integers/);
    expect(() => hcs14Uaid({ ...vector.input, name: ' ' })).toThrow(/required/);
    expect(base58(new Uint8Array([0, 0, 1]))).toBe('112');
  });
});

const stubEns = (fail = false): EnsClient => ({
  getEnsAddress: vi.fn(async ({ name }: { name: string }) => {
    if (fail) throw new Error('HTTP request failed');
    return name === NAME_FIXTURE.name ? NAME_FIXTURE.address : null;
  }),
  getEnsText: vi.fn(async ({ name, key }: { name: string; key: string }) => {
    if (fail) throw new Error('HTTP request failed');
    return name === NAME_FIXTURE.name && key === 'avatar' ? NAME_FIXTURE.avatar : null;
  }),
});
const viemOver = (file: string) =>
  createPublicClient({
    chain: mainnet,
    transport: http('https://eth.example.test/rpc', {
      fetchFn: fixtureFetch(`ens/${file}.json`, { jsonRpc: true }),
    }),
  });

describeNameResolver(
  'EnsResolver over viem + fixtures/ens/contract-suite.json',
  async () => new EnsResolver({ mainnetClient: viemOver('contract-suite') }),
);
describeNameResolver(
  'EnsResolver over a stub client',
  async () => new EnsResolver({ mainnetClient: stubEns() }),
);

describe('EnsResolver (T-43, L11)', () => {
  it('resolve-ok / resolve-null / text-avatar recordings through viem', async () => {
    await expect(
      new EnsResolver({ mainnetClient: viemOver('resolve-ok') }).resolve('Alice.ETH'),
    ).resolves.toBe(NAME_FIXTURE.address);
    await expect(
      new EnsResolver({ mainnetClient: viemOver('resolve-null') }).resolve('nobody.eth'),
    ).resolves.toBeNull();
    await expect(
      new EnsResolver({ mainnetClient: viemOver('text-avatar') }).getText('alice.eth', 'avatar'),
    ).resolves.toBe(NAME_FIXTURE.avatar);
  });

  it('mainnet failure ⇒ fallback used (logged); both failing ⇒ unavailable, never an unhandled throw', async () => {
    const debug = vi.fn();
    const r = new EnsResolver({
      mainnetClient: stubEns(true),
      fallbackClient: stubEns(),
      logger: { debug, warn: vi.fn() },
    });
    await expect(r.resolve('alice.eth')).resolves.toBe(NAME_FIXTURE.address);
    expect(debug).toHaveBeenCalledWith(expect.stringMatching(/source: fallback/));
    await expect(
      new EnsResolver({ mainnetClient: stubEns(true), fallbackClient: stubEns(true) }).resolve(
        'alice.eth',
      ),
    ).rejects.toMatchObject({ code: 'unavailable' });
    await expect(
      new EnsResolver({ mainnetClient: stubEns(true) }).getText('alice.eth', 'avatar'),
    ).rejects.toMatchObject({ code: 'unavailable' });
    await expect(
      new EnsResolver({ mainnetClient: stubEns() }).getText('alice.eth', 'bad key!'),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

const BATCH = 'cd'.repeat(32);
describeBlobStore('SwarmBlobStore over a fake Bee', async () => {
  const blobs = new Map<string, Uint8Array>();
  const bee: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (init?.method === 'POST') {
      const bytes = init.body as Uint8Array;
      const reference = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
      blobs.set(reference, bytes);
      return new Response(JSON.stringify({ reference }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }
    const ref = url.pathname.split('/')[2]!;
    const hit = blobs.get(ref);
    return hit ? new Response(hit) : new Response('{"code":404}', { status: 404 });
  };
  return new SwarmBlobStore({ beeUrl: 'http://localhost:1633', postageBatchId: BATCH, fetch: bee });
});

describe('SwarmBlobStore (L13)', () => {
  it('POST /bzz carries the postage batch header (fixtures/swarm/upload.json); GET /bzz/{ref}/ returns the bytes; unknown ⇒ null', async () => {
    const up = new SwarmBlobStore({
      beeUrl: 'http://localhost:1633',
      postageBatchId: BATCH,
      fetch: fixtureFetch('swarm/upload.json'),
    });
    await expect(up.put(new TextEncoder().encode('{"v":1}'), 'application/json')).resolves.toEqual({
      ref: `bzz://${'ab'.repeat(32)}`,
    });
    const wrongBatch = new SwarmBlobStore({
      beeUrl: 'http://localhost:1633',
      postageBatchId: 'ef'.repeat(32),
      fetch: fixtureFetch('swarm/upload.json'),
    });
    await expect(wrongBatch.put(new Uint8Array([1]), 'application/json')).rejects.toMatchObject({
      code: 'fixture_miss',
    });
    const down = new SwarmBlobStore({
      beeUrl: 'http://localhost:1633',
      postageBatchId: BATCH,
      fetch: fixtureFetch('swarm/download.json'),
    });
    const bytes = await down.get(`bzz://${'ab'.repeat(32)}`);
    expect(JSON.parse(new TextDecoder().decode(bytes))).toMatchObject({ v: 1 });
    await expect(down.get(`bzz://${'00'.repeat(32)}`)).resolves.toBeNull();
  });

  it('a 413 maps to too_large; bad config is refused', async () => {
    const big = new SwarmBlobStore({
      beeUrl: 'http://localhost:1633',
      postageBatchId: BATCH,
      fetch: fixtureFetch('swarm/upload-too-large.json'),
    });
    await expect(big.put(new Uint8Array([1]), 'application/json')).rejects.toMatchObject({
      adapter: 'blobs',
      code: 'too_large',
    });
    expect(
      () => new SwarmBlobStore({ beeUrl: 'http://localhost:1633', postageBatchId: 'x' }),
    ).toThrow(/64 hex/);
    expect(() => new SwarmBlobStore({ beeUrl: 'ftp://bee', postageBatchId: BATCH })).toThrow(
      /https/,
    );
  });
});
