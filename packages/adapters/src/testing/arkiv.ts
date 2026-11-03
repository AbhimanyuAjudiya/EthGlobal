/**
 * Test doubles for ArkivClientLike (INTERFACES §10 `fixtures/arkiv/*`): an in-memory chain whose block height
 * follows the injected clock, and a replayer of ArkivClientLike-level recordings. Both record every call so tests
 * assert what reached the SDK (no `btl`/`expiresIn` key, the `$creator` filter, the expiration form).
 */
import { sha256Hex } from '@ethglobal/crypto';
import { getAddress, type Address, type Hex } from 'viem';

import { loadFixture } from './fixtures.js';

import type {
  ArkivAttribute,
  ArkivClientLike,
  ArkivExpiration,
  ArkivRow,
  ArkivSchemaName,
  ArkivWhere,
} from '../live/arkiv-ledger.js';

export interface ArkivCall {
  method: keyof ArkivClientLike;
  args: unknown[];
}

interface FakeEntity extends ArkivRow {
  schema: ArkivSchemaName;
}

/**
 * An in-memory Arkiv: head = startBlock + floor((now − start) / blockTimeMs); entities vanish at `$expiresAt`.
 * `as(creator)` writes as another account (a look-alike forger, T-79). `fail` makes every call throw.
 */
export class FakeArkiv implements ArkivClientLike {
  readonly calls: ArkivCall[] = [];
  readonly #entities = new Map<Hex, FakeEntity>();
  readonly #start: number;
  #creator: Address;
  #seq = 0;
  fail = false;

  constructor(
    private readonly now: () => number,
    creator: Address,
    private readonly blockTimeMs = 2000,
    private readonly startBlock = 1_000_000n,
  ) {
    this.#start = now();
    this.#creator = getAddress(creator);
  }

  /** Subsequent writes come from `creator`. */
  as(creator: Address): this {
    this.#creator = getAddress(creator);
    return this;
  }

  #head(): bigint {
    return this.startBlock + BigInt(Math.floor((this.now() - this.#start) / this.blockTimeMs));
  }

  #call(method: keyof ArkivClientLike, args: unknown[]): void {
    this.calls.push({ method, args: structuredClone(args) });
    if (this.fail) throw new Error('ECONNRESET');
  }

  #resolve(expiration: ArkivExpiration): bigint {
    if (expiration.kind === 'atBlock') return expiration.block;
    if (expiration.seconds % 2 !== 0 || expiration.seconds <= 0) throw new Error('InvalidExpiryError');
    return this.#head() + BigInt((expiration.seconds * 1000) / this.blockTimeMs);
  }

  async createEntity(
    schema: ArkivSchemaName,
    values: Record<string, ArkivAttribute | Uint8Array>,
    opts: { expiration: ArkivExpiration },
  ) {
    this.#call('createEntity', [schema, values, opts]);
    this.#seq += 1;
    const key = sha256Hex(`arkiv-entity:${this.#seq}`);
    const expiresAt = this.#resolve(opts.expiration);
    this.#entities.set(key, { key, creator: this.#creator, expiresAt, values: { ...values }, schema });
    return { entityKey: key, txHash: sha256Hex(`tx:${this.#seq}`), expiresAt };
  }

  #alive(e: FakeEntity): boolean {
    return e.expiresAt > this.#head();
  }

  async getEntity(key: Hex): Promise<ArkivRow | null> {
    this.#call('getEntity', [key]);
    const e = this.#entities.get(key);
    return e && this.#alive(e) ? row(e) : null;
  }

  async select(schema: ArkivSchemaName | undefined, where: ArkivWhere, opts: { limit: number }) {
    this.#call('select', [schema, where, opts]);
    const entities = [...this.#entities.values()]
      .filter((e) => this.#alive(e))
      .filter((e) => schema === undefined || e.schema === schema)
      .filter((e) => e.creator === getAddress(where.creator))
      .filter((e) => Object.entries(where.eq).every(([k, v]) => e.values[k] === v))
      .filter((e) => where.afterKey === undefined || e.key > where.afterKey)
      .sort((a, b) => (a.key < b.key ? -1 : 1))
      .slice(0, opts.limit)
      .map(row);
    return { entities, skipped: 0 };
  }

  async patchEntity(
    schema: ArkivSchemaName,
    key: Hex,
    changes: { set: Record<string, ArkivAttribute | Uint8Array>; unset: string[] },
  ) {
    this.#call('patchEntity', [schema, key, changes]);
    const e = this.#entities.get(key);
    if (!e || !this.#alive(e) || e.creator !== this.#creator) throw new Error('EntityNotFound');
    for (const name of changes.unset) delete e.values[name];
    Object.assign(e.values, changes.set);
    return { txHash: sha256Hex(`patch:${key}:${this.calls.length}`) };
  }

  async extendEntity(key: Hex, expiration: ArkivExpiration) {
    this.#call('extendEntity', [key, expiration]);
    const e = this.#entities.get(key);
    if (!e || !this.#alive(e)) throw new Error('EntityNotFound');
    const next = this.#resolve(expiration);
    if (next < e.expiresAt) throw new Error('ExpiryMovesEarlier');
    e.expiresAt = next;
    return { txHash: sha256Hex(`extend:${key}:${this.calls.length}`), expiresAt: next };
  }

  async blockNumber(): Promise<bigint> {
    this.#call('blockNumber', []);
    return this.#head();
  }
}

function row(e: FakeEntity): ArkivRow {
  return { key: e.key, creator: e.creator, expiresAt: e.expiresAt, values: { ...e.values } };
}

/** JSON encoding of recorded values: `{ "$bigint": "1" }`, `{ "$utf8": "…" }`. */
function revive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o['$bigint'] === 'string') return BigInt(o['$bigint']);
    if (typeof o['$utf8'] === 'string') return new TextEncoder().encode(o['$utf8']);
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, revive(v)]));
  }
  return value;
}

interface ArkivRecording {
  name: string;
  recordedAt: string;
  source: 'docs' | 'live';
  calls: { method: keyof ArkivClientLike; result?: unknown; error?: string }[];
}

/**
 * Replays `fixtures/<relPath>`: each call returns the next recorded result for its method (the last one repeats),
 * or throws the recorded error. A method with no recording throws (the request shape is asserted).
 */
export function arkivFixtureClient(relPath: string): ArkivClientLike & { calls: ArkivCall[] } {
  const recording = loadFixture<ArkivRecording>(relPath);
  const calls: ArkivCall[] = [];
  const cursor = new Map<string, number>();
  const answer = (method: keyof ArkivClientLike, args: unknown[]): Promise<never> => {
    calls.push({ method, args });
    const recorded = recording.calls.filter((c) => c.method === method);
    if (!recorded.length) return Promise.reject(new Error(`arkiv fixture miss: ${method}`));
    const i = Math.min(cursor.get(method) ?? 0, recorded.length - 1);
    cursor.set(method, i + 1);
    const hit = recorded[i]!;
    return hit.error ? Promise.reject(new Error(hit.error)) : Promise.resolve(revive(hit.result) as never);
  };
  return {
    calls,
    createEntity: (...args) => answer('createEntity', args),
    getEntity: (...args) => answer('getEntity', args),
    select: (...args) => answer('select', args),
    patchEntity: (...args) => answer('patchEntity', args),
    extendEntity: (...args) => answer('extendEntity', args),
    blockNumber: (...args) => answer('blockNumber', args),
  };
}
