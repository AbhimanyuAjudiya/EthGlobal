/**
 * ArkivLedger (INTERFACES §3.3; A-23, A-24; T-35, T-79): the Ledger port over Arkiv entities on rabdi (7794095).
 * The SDK surface is isolated behind ArkivClientLike (arkiv-sdk.ts binds it to @arkiv-network/sdk), so this file
 * holds only the mapping rules and is tested over a fake client and ArkivClientLike-level fixtures.
 */
import { ANN, ENTITY_TYPES, type EntityType } from '@ethglobal/protocol/ids';
import { getAddress, isAddress, type Address, type Hex } from 'viem';

import { AdapterError } from '../errors.js';
import {
  annotationAlive,
  assertExpiresIn,
  assertLimit,
  matchesAnnotations,
} from '../ledger-rules.js';
import { guard } from './errors.js';

import type {
  Annotations,
  Ledger,
  LedgerEntity,
  LedgerPutInput,
  LedgerPutResult,
  LedgerQuery,
} from '../types.js';

/** Arkiv's lifetime cap (blocks) and the attribute size cap of a bytes column (A-24). */
export const ARKIV_MAX_LIFETIME_BLOCKS = 7_884_000n;
export const ARKIV_MAX_PAYLOAD_BYTES = 128 * 1024;
export const ARKIV_PAGE_SIZE = 100;
/** Upper bound on rows one query() returns, so an unbounded query cannot run away (L3). */
export const ARKIV_MAX_QUERY_ROWS = 1_000;

/** Annotation names stored as indexed u64 attributes; every other ANN name is an indexed str. */
export const NUMERIC_ANNOTATIONS: ReadonlySet<string> = new Set([ANN.expiresAt, ANN.day]);
const ANNOTATION_NAMES: ReadonlySet<string> = new Set(Object.values(ANN));

export type ArkivAttribute = string | bigint;
/** One schema per entity type, `recharge.<name>.v1`, plus `untyped` for entities without a type annotation. */
export type ArkivSchemaName = EntityType | 'untyped';
export const ARKIV_SCHEMA_NAMES: readonly ArkivSchemaName[] = [...ENTITY_TYPES, 'untyped'];
/** What the SDK's ExpirationTime builds: a whole number of 2-s blocks, or an absolute block (A-24). */
export type ArkivExpiration = { kind: 'seconds'; seconds: number } | { kind: 'atBlock'; block: bigint };

export interface ArkivRow {
  key: Hex;
  creator: Address;
  /** Block number at which the entity expires (`$expiresAt`). */
  expiresAt: bigint;
  /** `payload` (UTF-8 bytes), `createdAtMs` (u64) and the annotation attributes. */
  values: Record<string, ArkivAttribute | Uint8Array>;
}

export interface ArkivWhere {
  /** Rows not created by this account are never returned (T-79: `$creator`, not `$owner`). */
  creator: Address;
  eq: Record<string, ArkivAttribute>;
  /** Pagination by key: `gt('$key', afterKey)`, ordered `asc('$key')`. */
  afterKey?: Hex;
}

/** The SDK surface ArkivLedger needs, in plain data (one binding: arkiv-sdk.ts). */
export interface ArkivClientLike {
  createEntity(
    type: ArkivSchemaName,
    values: Record<string, ArkivAttribute | Uint8Array>,
    opts: { expiration: ArkivExpiration },
  ): Promise<{ entityKey: Hex; txHash: Hex; expiresAt: bigint }>;
  /** null for "no such entity" only; transport errors throw. */
  getEntity(key: Hex): Promise<ArkivRow | null>;
  select(
    type: ArkivSchemaName | undefined,
    where: ArkivWhere,
    opts: { limit: number },
  ): Promise<{ entities: ArkivRow[]; skipped: number }>;
  patchEntity(
    type: ArkivSchemaName,
    key: Hex,
    changes: { set: Record<string, ArkivAttribute | Uint8Array>; unset: string[] },
  ): Promise<{ txHash: Hex }>;
  extendEntity(key: Hex, expiration: ArkivExpiration): Promise<{ txHash: Hex; expiresAt: bigint }>;
  blockNumber(): Promise<bigint>;
}

export interface ArkivLedgerOptions {
  client: ArkivClientLike;
  /** Nominal 2000 on rabdi; measured on Wednesday (T-35). */
  blockTimeMs: number;
  now: () => number;
  /** Our writer (ARKIV_PRIVATE_KEY's address): every read filters `$creator` on it (T-79). Required. */
  writer: Address;
  logger?: Pick<Console, 'info' | 'warn'>;
}

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const HOUR_MS = 3_600_000;

const invalid = (message: string): AdapterError => new AdapterError('ledger', 'invalid_request', message);

export class ArkivLedger implements Ledger {
  readonly #client: ArkivClientLike;
  readonly #blockTimeMs: number;
  readonly #now: () => number;
  readonly #writer: Address;
  readonly #logger: Pick<Console, 'info' | 'warn'> | undefined;
  #lastDriftLog = Number.NEGATIVE_INFINITY;

  constructor(opts: ArkivLedgerOptions) {
    if (!opts.writer || !isAddress(opts.writer, { strict: false })) {
      throw new Error('ArkivLedger needs the writer address (reads filter $creator on it, T-79)');
    }
    if (!Number.isSafeInteger(opts.blockTimeMs) || opts.blockTimeMs <= 0) {
      throw new Error('ArkivLedger blockTimeMs must be a positive integer');
    }
    this.#client = opts.client;
    this.#blockTimeMs = opts.blockTimeMs;
    this.#now = opts.now;
    this.#writer = getAddress(opts.writer);
    this.#logger = opts.logger;
  }

  /** expiresIn seconds → whole blocks, rounded up (601 s ⇒ 301 blocks ⇒ fromSeconds(602)), A-24. */
  blocksFor(expiresIn: number): bigint {
    return BigInt(Math.ceil((expiresIn * 1000) / this.#blockTimeMs));
  }

  async put(input: LedgerPutInput): Promise<LedgerPutResult> {
    assertExpiresIn(input.expiresIn);
    const type = typeOf(input.annotations);
    const values = encodeValues(input.payload, input.annotations ?? {}, this.#now());
    const blocks = input.expiresIn === undefined ? ARKIV_MAX_LIFETIME_BLOCKS : this.blocksFor(input.expiresIn);
    if (blocks > ARKIV_MAX_LIFETIME_BLOCKS) throw invalid('expiresIn exceeds the Arkiv maximum lifetime');
    return guard('ledger', async () => {
      const expiration = await this.#expiration(blocks);
      const created = await this.#client.createEntity(type, values, { expiration });
      const head = await this.#client.blockNumber();
      if (input.expiresIn !== undefined) this.#logDrift(input.expiresIn, blocks);
      return { key: created.entityKey, expiresAt: this.#msAt(created.expiresAt, head) };
    });
  }

  async get(key: string): Promise<LedgerEntity | null> {
    if (!HEX32.test(key)) return null; // not an Arkiv entity key (e.g. a logical key): nothing to fetch
    return guard('ledger', async () => {
      const [row, head] = await Promise.all([this.#client.getEntity(key as Hex), this.#client.blockNumber()]);
      return row ? this.#visible(row, head) : null;
    });
  }

  async query(query: LedgerQuery = {}): Promise<LedgerEntity[]> {
    assertLimit(query.limit);
    const wanted = query.annotations ?? {};
    const eq = encodeFilter(wanted);
    if (eq === null) return []; // a name or a type no stored entity can carry: nothing matches (no coercion)
    const type = typeof wanted[ANN.type] === 'string' ? (wanted[ANN.type] as EntityType) : undefined;
    if (type !== undefined && !(ENTITY_TYPES as readonly string[]).includes(type)) return [];
    const max = Math.min(query.limit ?? ARKIV_MAX_QUERY_ROWS, ARKIV_MAX_QUERY_ROWS);
    if (max === 0) return [];
    return guard('ledger', async () => {
      const head = await this.#client.blockNumber();
      const found: LedgerEntity[] = [];
      let afterKey: Hex | undefined;
      for (;;) {
        const where: ArkivWhere = { creator: this.#writer, eq, ...(afterKey ? { afterKey } : {}) };
        const page = await this.#client.select(type, where, { limit: ARKIV_PAGE_SIZE });
        if (page.skipped > 0) this.#logger?.warn(`arkiv: ${page.skipped} entities did not fit the schema`);
        for (const row of page.entities) {
          const entity = this.#visible(row, head);
          if (entity && matchesAnnotations(entity, wanted)) found.push(entity);
        }
        const last = page.entities.at(-1);
        if (found.length >= max || !last || page.entities.length + page.skipped < ARKIV_PAGE_SIZE) break;
        afterKey = last.key;
      }
      return found
        .sort((a, b) => a.createdAt - b.createdAt || a.key.localeCompare(b.key))
        .slice(0, max);
    });
  }

  async update(
    key: string,
    patch: { payload?: string; annotations?: Annotations },
    expiresIn?: number,
  ): Promise<LedgerPutResult> {
    assertExpiresIn(expiresIn);
    const current = await this.get(key);
    if (!current) throw new AdapterError('ledger', 'not_found', `no live entity ${key}`);
    const type = typeOf(current.annotations);
    const annotations = patch.annotations ?? current.annotations;
    if (patch.annotations !== undefined && typeOf(patch.annotations) !== type) {
      throw invalid('update cannot change the entity type (its schema)');
    }
    const next = encodeValues(patch.payload ?? current.payload, annotations, current.createdAt);
    const unset = Object.keys(current.annotations).filter((name) => !(name in annotations));
    const blocks = expiresIn === undefined ? undefined : this.blocksFor(expiresIn);
    return guard('ledger', async () => {
      await this.#client.patchEntity(type, key as Hex, { set: next, unset });
      const head = await this.#client.blockNumber();
      let expiresAtBlock = this.#blockAt(current, head);
      if (blocks !== undefined) {
        // The engine refuses to move an expiry earlier; a shorter request keeps the current expiry, and the
        // `expiresAt` annotation (min of two clocks, T-35) still ends the entity on time.
        if (head + blocks > expiresAtBlock) {
          const extended = await this.#client.extendEntity(key as Hex, await this.#expiration(blocks, head));
          expiresAtBlock = extended.expiresAt;
          this.#logDrift(expiresIn!, blocks);
        } else {
          this.#logger?.warn('arkiv: update asked for a shorter lifetime; the ledger keeps the longer one');
        }
      }
      return { key, expiresAt: this.#msAt(expiresAtBlock, head) };
    });
  }

  async #expiration(blocks: bigint, knownHead?: bigint): Promise<ArkivExpiration> {
    if (this.#blockTimeMs === 2000) return { kind: 'seconds', seconds: Number(blocks) * 2 };
    const head = knownHead ?? (await this.#client.blockNumber());
    return { kind: 'atBlock', block: head + blocks };
  }

  #msAt(expiresAtBlock: bigint, head: bigint): number {
    return Number(expiresAtBlock - head) * this.#blockTimeMs + this.#now();
  }

  #blockAt(entity: LedgerEntity, head: bigint): bigint {
    return head + BigInt(Math.ceil(((entity.expiresAt ?? this.#now()) - this.#now()) / this.#blockTimeMs));
  }

  #visible(row: ArkivRow, head: bigint): LedgerEntity | null {
    if (row.creator.toLowerCase() !== this.#writer.toLowerCase()) return null; // forged look-alike (T-79)
    if (row.expiresAt <= head) return null;
    const entity = decodeRow(row, this.#msAt(row.expiresAt, head));
    return entity && annotationAlive(entity.annotations, this.#now()) ? entity : null;
  }

  #logDrift(expiresIn: number, blocks: bigint): void {
    const now = this.#now();
    if (now - this.#lastDriftLog < HOUR_MS) return;
    this.#lastDriftLog = now;
    const impliedDriftSec = Math.abs(Number(blocks) * (this.#blockTimeMs / 1000) - expiresIn);
    this.#logger?.info(`arkiv: expiresIn ${expiresIn}s → ${blocks} blocks (impliedDriftSec ${impliedDriftSec})`);
  }
}

/** The schema an entity is written through: its `type` annotation, or the generic `untyped` schema. */
function typeOf(annotations: Annotations | undefined): ArkivSchemaName {
  const type = annotations?.[ANN.type];
  if (type === undefined) return 'untyped';
  if (typeof type !== 'string' || !(ENTITY_TYPES as readonly string[]).includes(type)) {
    throw invalid(`annotation type must be one of ${ENTITY_TYPES.join(', ')}`);
  }
  return type as EntityType;
}

function encodeValue(name: string, value: string | number): ArkivAttribute {
  if (!ANNOTATION_NAMES.has(name)) throw invalid(`annotation ${name} is not in the allow-list (T-37)`);
  if (NUMERIC_ANNOTATIONS.has(name)) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw invalid(`annotation ${name} must be a non-negative integer`);
    }
    return BigInt(value);
  }
  if (typeof value !== 'string') throw invalid(`annotation ${name} must be a string`);
  return value;
}

function encodeValues(
  payload: string,
  annotations: Annotations,
  createdAt: number,
): Record<string, ArkivAttribute | Uint8Array> {
  const bytes = new TextEncoder().encode(payload);
  if (bytes.length > ARKIV_MAX_PAYLOAD_BYTES) {
    throw new AdapterError('ledger', 'too_large', `payload exceeds ${ARKIV_MAX_PAYLOAD_BYTES} bytes`);
  }
  const values: Record<string, ArkivAttribute | Uint8Array> = { payload: bytes, createdAtMs: BigInt(createdAt) };
  for (const [name, value] of Object.entries(annotations)) values[name] = encodeValue(name, value);
  return values;
}

/** Query values → attribute values; null when no stored entity could match (unknown name or wrong type). */
function encodeFilter(wanted: Annotations): Record<string, ArkivAttribute> | null {
  const eq: Record<string, ArkivAttribute> = {};
  for (const [name, value] of Object.entries(wanted)) {
    if (!ANNOTATION_NAMES.has(name)) return null;
    const numeric = NUMERIC_ANNOTATIONS.has(name);
    if (numeric !== (typeof value === 'number')) return null;
    if (numeric && !(Number.isSafeInteger(value) && (value as number) >= 0)) return null;
    eq[name] = numeric ? BigInt(value) : (value as string);
  }
  return eq;
}

function decodeRow(row: ArkivRow, expiresAt: number): LedgerEntity | null {
  const { payload, createdAtMs, ...rest } = row.values;
  if (!(payload instanceof Uint8Array) || typeof createdAtMs !== 'bigint') return null;
  const annotations: Annotations = {};
  for (const [name, value] of Object.entries(rest)) {
    if (!ANNOTATION_NAMES.has(name)) continue;
    if (typeof value === 'bigint') annotations[name] = Number(value);
    else if (typeof value === 'string') annotations[name] = value;
  }
  return {
    key: row.key,
    payload: new TextDecoder().decode(payload),
    annotations,
    createdAt: Number(createdAtMs),
    expiresAt,
  };
}
