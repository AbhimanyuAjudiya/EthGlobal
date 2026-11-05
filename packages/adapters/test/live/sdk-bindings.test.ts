import { createWalletClient, ExpirationTime } from '@arkiv-network/sdk';
import { SchemaMismatchError } from '@arkiv-network/sdk/schema';
import { http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import {
  arkivChain,
  arkivSchemas,
  createArkivClient,
  fromSdkRow,
  KAOLIN_CHAIN_ID,
  toSdkExpiration,
  toSdkValues,
  toSdkWhere,
} from '../../src/live/arkiv-sdk.js';
import {
  buildTokenTransfer,
  buildTopicMessage,
  createHederaClient,
} from '../../src/live/hedera-sdk.js';
import { anvilAccounts, anvilKeys } from '../../src/testing/index.js';

/** A JSON-RPC endpoint that answers a few methods, recording what was asked. */
function rpc(answers: Record<string, unknown>) {
  const seen: { url: string; method: string; params: unknown }[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const body = JSON.parse(init?.body as string) as {
      id: number;
      method: string;
      params: unknown;
    };
    seen.push({ url: input as string, method: body.method, params: body.params });
    const result = answers[body.method];
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: result ?? null }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetchFn, seen };
}

describe('@arkiv-network/sdk binding (A-23, A-24)', () => {
  it('rabdi chain id 7794095 and the access key in the RPC path; tiramisu from env; Kaolin refused naming A-23', () => {
    const rabdi = arkivChain(
      7_794_095,
      'https://rpc.rabdi.db-chain.testnet.arkiv.network',
      'my-key',
    );
    expect(rabdi.id).toBe(7_794_095);
    expect(rabdi.rpcUrls.default.http[0]).toBe(
      'https://rpc.rabdi.db-chain.testnet.arkiv.network/my-key',
    );
    const custom = arkivChain(7_794_095, 'https://proxy.example/arkiv/', 'k');
    expect(custom.rpcUrls.default.http[0]).toBe('https://proxy.example/arkiv/k');
    expect(
      arkivChain(7_738_577, 'https://rpc.tiramisu.db-chain.testnet.arkiv.network', '').rpcUrls
        .default.http[0],
    ).toBe('https://rpc.tiramisu.db-chain.testnet.arkiv.network');
    expect(() => arkivChain(KAOLIN_CHAIN_ID, 'https://x.example', '')).toThrow(/A-23/);
    expect(() => arkivChain(1, 'https://x.example', '')).toThrow(/7794095/);
  });

  it('one schema per entity type validates with the real SDK (payload bytes, logicalKey instead of the reserved "key")', () => {
    const schemas = arkivSchemas();
    expect(Object.keys(schemas).sort()).toEqual([
      'agentpolicy',
      'campaign',
      'claim',
      'entitlement',
      'gift',
      'nonce',
      'receipt',
      'untyped',
    ]);
  });

  it('expiration descriptors become the SDK ExpirationTime values (fromSeconds(604800) = 302400 blocks)', () => {
    expect(toSdkExpiration({ kind: 'seconds', seconds: 604_800 })).toEqual(
      ExpirationTime.fromSeconds(604_800),
    );
    expect(toSdkExpiration({ kind: 'atBlock', block: 123n })).toEqual(ExpirationTime.atBlock(123n));
    expect(() => toSdkExpiration({ kind: 'seconds', seconds: 601 })).toThrow(); // the SDK rejects odd seconds; ArkivLedger never sends them
  });

  it('where: $creator first, then attribute equalities, then $key pagination', () => {
    const one = JSON.stringify(
      toSdkWhere({ creator: anvilAccounts[2], eq: {} }),
      (_k, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v),
    );
    expect(one).toContain('$creator');
    const many = JSON.stringify(
      toSdkWhere({
        creator: anvilAccounts[2],
        eq: { type: 'gift', day: 3n },
        afterKey: `0x${'a'.repeat(64)}`,
      }),
      (_k, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v),
    );
    for (const part of ['$creator', 'gift', 'day', '$key']) expect(many).toContain(part);
    expect(many).toContain('"u64"'); // numeric equalities are u64-tagged, like the written columns (RT-A-15)
  });

  it('schemaless rows map to ArkivRow (bytes hex → Uint8Array, u64 bigint, str)', () => {
    const row = fromSdkRow({
      $key: `0x${'1'.repeat(64)}`,
      $creator: anvilAccounts[2],
      $expiresAt: 10n,
      $attributes: {
        payload: { type: 'bytes', value: '0x7b7d' },
        day: { type: 'u64', value: 3n },
        type: { type: 'str', value: 'gift' },
        flag: { type: 'bool', value: true },
      },
    });
    expect(row).toEqual({
      key: `0x${'1'.repeat(64)}`,
      creator: anvilAccounts[2],
      expiresAt: 10n,
      values: { payload: new Uint8Array([0x7b, 0x7d]), day: 3n, type: 'gift' },
    });
  });

  it('createArkivClient: blockNumber over JSON-RPC to the keyed URL; a missing entity is null; writes need a key', async () => {
    const { fetchFn, seen } = rpc({ eth_blockNumber: '0x10', arkiv_getEntity: null });
    const client = createArkivClient({
      chainId: 7_794_095,
      rpcUrl: 'https://rpc.rabdi.db-chain.testnet.arkiv.network',
      accessKey: 'k1',
      fetchFn,
    });
    await expect(client.blockNumber()).resolves.toBe(16n);
    await expect(client.getEntity(`0x${'2'.repeat(64)}`)).resolves.toBeNull();
    expect(seen[0]!.url).toBe('https://rpc.rabdi.db-chain.testnet.arkiv.network/k1');
    expect(seen.map((s) => s.method)).toEqual(['eth_blockNumber', 'arkiv_getEntity']);
    await expect(
      client.createEntity(
        'gift',
        { payload: new Uint8Array([1]) },
        { expiration: { kind: 'seconds', seconds: 2 } },
      ),
    ).rejects.toThrow(/read-only/);
    const writer = createArkivClient({
      chainId: 7_794_095,
      rpcUrl: 'https://rpc.rabdi.db-chain.testnet.arkiv.network',
      accessKey: '',
      privateKey: anvilKeys[2],
      fetchFn,
    });
    expect(writer).toBeDefined();
  });
});

/**
 * RT-A-15 (T-35): the first live write on rabdi (2026-11-05) failed inside the SDK — `SchemaMismatchError: Column
 * "createdAtMs": a u64 column, but the value is a u256` — because SDK 1.0.1 types a bare bigint as u256. The SDK's
 * schema check runs before any RPC, so a transport that refuses every request tells the two apart: a write that is
 * refused by the schema never reaches it; a write that reaches it fails with the transport's own error.
 */
describe('RT-A-15: u64 columns cross the SDK boundary as u64(value), never a bare bigint', () => {
  const RPC = 'https://rpc.rabdi.db-chain.testnet.arkiv.network';
  const ENTITY_KEY = `0x${'a'.repeat(64)}` as const;
  /** Every JSON-RPC request is answered with one error (a code viem never retries), recording the method asked. */
  function sentinelRpc() {
    const methods: string[] = [];
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(init?.body as string) as { id: number; method: string };
      methods.push(body.method);
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          error: { code: 4242, message: 'SENTINEL_TRANSPORT' },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    };
    return { fetchFn, methods };
  }
  /** What ArkivLedger.encodeValues hands over for a gift: payload bytes, u64 createdAtMs/rev/expiresAt/day, str type. */
  const values = {
    payload: new TextEncoder().encode('{"v":1}'),
    createdAtMs: 1_762_340_700_000n,
    rev: 1n,
    type: 'gift',
    expiresAt: 1_762_945_500_000n,
    day: 20_397n,
  };
  const chainOf = (fetchFn: typeof fetch) => ({
    chain: arkivChain(7_794_095, RPC, 'k'),
    transport: http(undefined, { fetchFn }),
    account: privateKeyToAccount(anvilKeys[2]),
  });
  /** The error chain's messages, so a sentinel wrapped by viem (`cause`) is still found. */
  const chain = (error: unknown): string[] =>
    error instanceof Error ? [error.message, ...chain(error.cause)] : [];

  it('toSdkValues tags every value by its column type: bigint → u64, string → str, Uint8Array → bytes', () => {
    const tagged = toSdkValues(values) as Record<string, { type: string; value: unknown }>;
    expect(Object.fromEntries(Object.entries(tagged).map(([k, v]) => [k, v.type]))).toEqual({
      payload: 'bytes',
      createdAtMs: 'u64',
      rev: 'u64',
      type: 'str',
      expiresAt: 'u64',
      day: 'u64',
    });
    expect(tagged.createdAtMs!.value).toBe(1_762_340_700_000n);
  });

  it('pre-fix shape (bare bigint): the real SDK refuses the create and the patch before any RPC — SchemaMismatchError', async () => {
    const { fetchFn, methods } = sentinelRpc();
    const wallet = createWalletClient(chainOf(fetchFn));
    const schema = arkivSchemas().gift as never;
    const create = await wallet
      .createEntity(schema, values as never, { expiration: ExpirationTime.fromSeconds(604_800) })
      .catch((error: unknown) => error);
    expect(create).toBeInstanceOf(SchemaMismatchError);
    expect(String(create)).toMatch(/"createdAtMs": a u64 column, but the value is a u256/);
    const patch = await wallet
      .patchEntity(schema, ENTITY_KEY, { set: { rev: 2n } })
      .catch((error: unknown) => error);
    expect(patch).toBeInstanceOf(SchemaMismatchError);
    expect(methods).toEqual([]); // the check is client-side: nothing was sent
  });

  it('createArkivClient: createEntity and patchEntity pass the schema check and fail only at the transport', async () => {
    const { fetchFn, methods } = sentinelRpc();
    const client = createArkivClient({
      chainId: 7_794_095,
      rpcUrl: RPC,
      accessKey: 'k',
      privateKey: anvilKeys[2],
      fetchFn,
    });
    const create = await client
      .createEntity('gift', values, { expiration: { kind: 'seconds', seconds: 604_800 } })
      .catch((error: unknown) => error);
    expect(create).not.toBeInstanceOf(SchemaMismatchError);
    expect(chain(create).join('\n')).toMatch(/SENTINEL_TRANSPORT/);
    expect(methods.length).toBeGreaterThan(0);
    const sent = methods.length;
    const patch = await client
      .patchEntity('gift', ENTITY_KEY, { set: { ...values, rev: 2n }, unset: ['logicalKey'] })
      .catch((error: unknown) => error);
    expect(patch).not.toBeInstanceOf(SchemaMismatchError);
    expect(chain(patch).join('\n')).toMatch(/SENTINEL_TRANSPORT/);
    expect(methods.length).toBeGreaterThan(sent);
  });
});

describe('@hiero-ledger/sdk binding via @x402/hedera (A-22)', () => {
  it('builds the topic message and the two-leg HTS transfer without sending', () => {
    const msg = buildTopicMessage('0.0.4242', '{"v":1}');
    expect(msg.topicId?.toString()).toBe('0.0.4242');
    expect(new TextDecoder().decode(msg.getMessage() ?? new Uint8Array())).toBe('{"v":1}');
    const tx = buildTokenTransfer({
      tokenId: '0.0.429274',
      from: '0.0.7007',
      to: '0.0.5005',
      amount: 400_000n,
      memo: 'reclaim',
    });
    expect(tx.transactionMemo).toBe('reclaim');
    const legs = [
      ...((tx.tokenTransfers.get('0.0.429274') ?? []) as unknown as Iterable<
        [{ toString(): string }, { toString(): string }]
      >),
    ].map(([a, v]) => [a.toString(), v.toString()]);
    expect(legs).toEqual([
      ['0.0.7007', '-400000'],
      ['0.0.5005', '400000'],
    ]);
  });

  it('createHederaClient takes an ECDSA key and does no I/O at construction', () => {
    const client = createHederaClient({
      network: 'testnet',
      accountId: '0.0.6006',
      privateKey: `0x${'c3'.repeat(32)}`,
    });
    expect(typeof client.submitTopicMessage).toBe('function');
    expect(() =>
      createHederaClient({
        network: 'testnet',
        accountId: 'nope',
        privateKey: `0x${'c3'.repeat(32)}`,
      }),
    ).toThrow();
  });
});
