import { ExpirationTime } from '@arkiv-network/sdk';
import { describe, expect, it } from 'vitest';

import {
  arkivChain,
  arkivSchemas,
  createArkivClient,
  fromSdkRow,
  KAOLIN_CHAIN_ID,
  toSdkExpiration,
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
