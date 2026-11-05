/**
 * The one file that touches @arkiv-network/sdk (pinned 1.0.1, A-23): binds ArkivClientLike to the SDK's public and
 * wallet clients on rabdi (7794095) — or tiramisu (7738577) when configured. Kaolin is retired and refused.
 * [verify Wed] the schemaless select/getEntity row shape and `eq('$creator', …)` against rabdi.
 * Verified live 2026-11-05 (RT-A-15): the SDK's client-side schema check types a bare bigint as u256, so every
 * attribute value crosses this boundary tagged (toSdkValues) — a u64 column refuses anything else before any RPC.
 */
import { createPublicClient, createWalletClient, ExpirationTime } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { and, asc, eq, gt } from '@arkiv-network/sdk/query';
import { addr, bytes, defineSchema, key as keyValue, str, u64 } from '@arkiv-network/sdk/schema';
import {
  defineChain,
  hexToBytes,
  http,
  type Address,
  type Chain,
  type Hex,
  type HttpTransportConfig,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { ANN } from '@ethglobal/protocol/ids';

import {
  arkivAttribute,
  ARKIV_SCHEMA_NAMES,
  NUMERIC_ANNOTATIONS,
  type ArkivAttribute,
  type ArkivClientLike,
  type ArkivExpiration,
  type ArkivRow,
  type ArkivSchemaName,
  type ArkivWhere,
} from './arkiv-ledger.js';

export const RABDI_CHAIN_ID = 7_794_095;
export const TIRAMISU_CHAIN_ID = 7_738_577;
// nosemgrep: recharge-arkiv-legacy-primitive — the refusal constant: arkivChain() and liveConfigSchema reject this id
export const KAOLIN_CHAIN_ID = 60_138_453_025;
const RABDI_HOST = 'rpc.rabdi.db-chain.testnet.arkiv.network';

export interface ArkivSdkOptions {
  chainId: number;
  rpcUrl: string;
  accessKey: string;
  /** Absent for a read-only client (the agent): writes then throw. */
  privateKey?: Hex;
  /** Injected for tests and the Wednesday recorder. */
  fetchFn?: HttpTransportConfig['fetchFn'];
}

/** The viem chain for the configured Arkiv network; throws for Kaolin (A-23) or any unknown id. */
export function arkivChain(chainId: number, rpcUrl: string, accessKey: string): Chain {
  if (chainId === KAOLIN_CHAIN_ID) {
    throw new Error(
      'ARKIV_CHAIN_ID 60138453025 is Kaolin, which is retired (INTERFACES A-23): use rabdi 7794095',
    );
  }
  if (chainId === RABDI_CHAIN_ID) {
    if (new URL(rpcUrl).host === RABDI_HOST) return rabdi({ accessKey });
  } else if (chainId !== TIRAMISU_CHAIN_ID) {
    throw new Error(`ARKIV_CHAIN_ID must be 7794095 (rabdi) or 7738577 (tiramisu); got ${chainId}`);
  }
  const url =
    accessKey === '' ? rpcUrl : `${rpcUrl.replace(/\/$/, '')}/${encodeURIComponent(accessKey)}`;
  return defineChain({
    id: chainId,
    name: chainId === RABDI_CHAIN_ID ? 'Rabdi' : 'Tiramisu',
    nativeCurrency: { name: 'Golem', symbol: 'tGLM', decimals: 18 },
    rpcUrls: { default: { http: [url] } },
    testnet: true,
  });
}

/**
 * One schema per entity type: payload bytes (never indexed), createdAtMs u64, rev u64 (the A-32 revision; optional
 * so rows written before it still validate), every ANN attribute indexed.
 */
export function arkivSchemas() {
  const columns = (typed: boolean) => {
    const out: Record<string, unknown> = {
      payload: bytes(),
      createdAtMs: u64(),
      rev: u64().optional(),
    };
    for (const name of Object.values(ANN)) {
      const column = NUMERIC_ANNOTATIONS.has(name) ? u64().indexed() : str().indexed();
      out[arkivAttribute(name)] = name === ANN.type && typed ? column : column.optional();
    }
    return out;
  };
  return Object.fromEntries(
    ARKIV_SCHEMA_NAMES.map((name) => [
      name,
      defineSchema(`recharge.${name}.v1`, columns(name !== 'untyped') as never),
    ]),
  ) as unknown as Record<ArkivSchemaName, ReturnType<typeof defineSchema>>;
}

/** Our expiration descriptor → the SDK's ExpirationTime value. */
export function toSdkExpiration(expiration: ArkivExpiration) {
  return expiration.kind === 'seconds'
    ? ExpirationTime.fromSeconds(expiration.seconds)
    : ExpirationTime.atBlock(expiration.block);
}

/** The where expression ArkivLedger asks for, in SDK query nodes: `$creator` first, always (T-79). */
export function toSdkWhere(where: ArkivWhere) {
  const nodes = [
    eq('$creator', addr(where.creator) as never),
    ...Object.entries(where.eq).map(([name, value]) =>
      eq(name as never, (typeof value === 'bigint' ? u64(value) : str(value)) as never),
    ),
    ...(where.afterKey ? [gt('$key', keyValue(where.afterKey) as never)] : []),
  ];
  return nodes.length === 1 ? nodes[0]! : and(...(nodes as [never, never, ...never[]]));
}

/**
 * Attribute values → SDK tagged values for createEntity / patchEntity. SDK 1.0.1 infers a bare bigint as u256 (its
 * `toValue`), which a `u64()` column rejects client-side with SchemaMismatchError (seen on the first rabdi write,
 * RT-A-15); bare strings and Uint8Arrays would infer correctly, but tagging all three keeps the write shape explicit.
 */
export function toSdkValues(values: Record<string, ArkivAttribute | Uint8Array>) {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      typeof value === 'bigint'
        ? u64(value)
        : typeof value === 'string'
          ? str(value)
          : bytes(value),
    ]),
  );
}

interface SdkValue {
  type: string;
  value: unknown;
}

/** A schemaless SDK row (`$key`, `$creator`, `$expiresAt`, `$attributes`) → ArkivRow. */
export function fromSdkRow(row: Record<string, unknown>): ArkivRow {
  const attributes = (row.$attributes ?? {}) as Record<string, SdkValue>;
  const values: Record<string, ArkivAttribute | Uint8Array> = {};
  for (const [name, attr] of Object.entries(attributes)) {
    if (attr.type === 'bytes') values[name] = hexToBytes(attr.value as Hex);
    else if (typeof attr.value === 'bigint' || typeof attr.value === 'string')
      values[name] = attr.value;
  }
  return {
    key: row.$key as Hex,
    creator: row.$creator as Address,
    expiresAt: BigInt(row.$expiresAt as bigint),
    values,
  };
}

const isNotFound = (error: unknown): boolean =>
  error instanceof Error && error.name === 'NoEntityFoundError';

/** Binds ArkivClientLike to the SDK. Network calls happen only when a method is called. */
export function createArkivClient(opts: ArkivSdkOptions): ArkivClientLike {
  const chain = arkivChain(opts.chainId, opts.rpcUrl, opts.accessKey);
  const transport = http(undefined, opts.fetchFn ? { fetchFn: opts.fetchFn } : {});
  const schemas = arkivSchemas();
  const pub = createPublicClient({ chain, transport }) as unknown as Record<
    string,
    (...a: unknown[]) => unknown
  > & {
    select(sel: '*'): {
      where(e: unknown): {
        orderBy(o: unknown): {
          limit(n: number): {
            fetch(): Promise<{ entities: Record<string, unknown>[]; skipped: number }>;
          };
        };
      };
    };
  };
  const wallet = opts.privateKey
    ? (createWalletClient({
        chain,
        transport,
        account: privateKeyToAccount(opts.privateKey),
      }) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)
    : undefined;
  const write = () => {
    if (!wallet) throw new Error('arkiv: read-only client (no ARKIV_PRIVATE_KEY)');
    return wallet;
  };
  return {
    async createEntity(type, values, { expiration }) {
      return (await write().createEntity!(schemas[type], toSdkValues(values), {
        expiration: toSdkExpiration(expiration),
      })) as { entityKey: Hex; txHash: Hex; expiresAt: bigint };
    },
    async getEntity(entityKey) {
      try {
        return fromSdkRow((await pub.getEntity!(entityKey)) as Record<string, unknown>);
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async select(_type, where, { limit }) {
      const page = await pub
        .select('*')
        .where(toSdkWhere(where))
        .orderBy(asc('$key'))
        .limit(limit)
        .fetch();
      return { entities: page.entities.map(fromSdkRow), skipped: page.skipped };
    },
    async patchEntity(type, entityKey, changes) {
      return (await write().patchEntity!(schemas[type], entityKey, {
        set: toSdkValues(changes.set),
        unset: changes.unset,
      })) as { txHash: Hex };
    },
    async extendEntity(entityKey, expiration) {
      return (await write().extendEntity!({
        entityKey,
        expiration: toSdkExpiration(expiration),
      })) as {
        txHash: Hex;
        expiresAt: bigint;
      };
    },
    async blockNumber() {
      return (await pub.getBlockNumber!()) as bigint;
    },
  };
}
