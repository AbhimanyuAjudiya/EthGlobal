/**
 * The one query shape and the one codec contract for every ledger entity (INTERFACES §1.4, A-8; T-35, T-36).
 * Nothing outside `store/` calls `ledger.put/query/update`; nothing here calls `ledger.get` with a
 * caller-supplied string (lookups go by the logical `key` annotation, never by entity key).
 */
import type {
  Annotations,
  AnnotationValue,
  Ledger,
  LedgerEntity,
  LedgerPutResult,
} from '@ethglobal/adapters';
import { RechargeError } from '@ethglobal/protocol/errors';
import { ANN, type EntityType } from '@ethglobal/protocol/ids';
import { secondsUntil } from '@ethglobal/protocol/units';

export interface Found<T> {
  entityKey: string;
  payload: T;
  expiresAt: number | null;
  /** The ledger revision this payload was read at (A-32): the compare-and-swap token for the next write. */
  version: number;
}

/** How many times a compare-and-swap is retried on a fresh read before the store gives up (A-32). */
export const CAS_ATTEMPTS = 8;

/** A ledger conflict (create-if-absent lost, or a CAS on a stale version), duck-typed: no adapter runtime. */
export const isConflict = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'conflict';

/** The structural slice of a zod schema the stores need (keeps zod out of octroi's own dependencies). */
export interface PayloadSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown };
}

/** How one entity type maps to the ledger: payload schema, logical key, annotations, lifetime. */
export interface Codec<T> {
  type: EntityType;
  schema: PayloadSchema<T>;
  key(payload: T): string;
  /** Annotations other than `type` and `key`; undefined values are omitted. */
  annotations(payload: T): Record<string, AnnotationValue | undefined>;
  /** Ledger lifetime in seconds for a write at `now`. */
  expiresIn(payload: T, now: number): number;
}

/**
 * Live = the ledger still holds it (its own expiry is in the future) AND the indexed `expiresAt` annotation,
 * when present, is in the future: the minimum of two clocks (T-35). A non-numeric `expiresAt` is dead.
 */
export function isLive(entity: LedgerEntity, now: number): boolean {
  const ledgerLive = entity.expiresAt === null || entity.expiresAt > now;
  const at = entity.annotations[ANN.expiresAt];
  const annotationLive = at === undefined || (typeof at === 'number' && at > now);
  return ledgerLive && annotationLive;
}

/** Lifetime until `atMs`; refuses to write an entity that is already dead. */
export function lifetimeUntil(atMs: number, now: number): number {
  if (!(atMs > now)) {
    throw new RechargeError('invalid_request', 'entity would already be expired', { atMs, now });
  }
  return secondsUntil(atMs, now);
}

/** Hex and address annotation values are compared lower-cased on both write and query. */
export const lower = <S extends string | undefined>(value: S): S =>
  (value === undefined ? value : value.toLowerCase()) as S;

const invalidPayload = (type: EntityType, issues: unknown): RechargeError =>
  new RechargeError('invalid_request', `invalid ${type} payload`, issues);

/** Generic access for one entity type. Validates on write AND on read (a malformed entity is an attack). */
export class Repo<T> {
  constructor(
    private readonly ledger: Ledger,
    private readonly now: () => number,
    private readonly codec: Codec<T>,
  ) {}

  /** `{ type, key, …derived }` with undefined values dropped. */
  annotationsFor(payload: T): Annotations {
    const out: Annotations = { [ANN.type]: this.codec.type, [ANN.key]: this.codec.key(payload) };
    for (const [name, value] of Object.entries(this.codec.annotations(payload))) {
      if (value !== undefined) out[name] = value;
    }
    return out;
  }

  /** The one query shape: `{ annotations: { type, …filter }, limit? }`, live entities only. */
  async #query(filter: Annotations, limit?: number): Promise<LedgerEntity[]> {
    const now = this.now();
    const rows = await this.ledger.query({
      annotations: { ...filter, [ANN.type]: this.codec.type },
      ...(limit === undefined ? {} : { limit }),
    });
    return rows.filter((entity) => isLive(entity, now));
  }

  /** Payload if it parses AND every annotation derived from it equals the stored one; null otherwise. */
  decode(entity: LedgerEntity): Found<T> | null {
    let raw: unknown;
    try {
      raw = JSON.parse(entity.payload);
    } catch {
      return null;
    }
    const parsed = this.codec.schema.safeParse(raw);
    if (!parsed.success) return null;
    const derived = this.annotationsFor(parsed.data);
    const consistent = Object.entries(derived).every(
      ([name, value]) => entity.annotations[name] === value,
    );
    return consistent
      ? {
          entityKey: entity.key,
          payload: parsed.data,
          expiresAt: entity.expiresAt,
          version: entity.version ?? 1,
        }
      : null;
  }

  /** At most one live entity may match; two is a corruption (or a forgery) and fails closed. */
  async findOne(filter: Annotations): Promise<Found<T> | null> {
    const rows = await this.#query(filter, 2);
    if (rows.length > 1) {
      throw new RechargeError(
        'internal_error',
        `two live ${this.codec.type} entities for one lookup`,
      );
    }
    const [row] = rows;
    return row === undefined ? null : this.decode(row);
  }

  async findAll(filter: Annotations = {}, limit?: number): Promise<Found<T>[]> {
    const rows = await this.#query(filter, limit);
    return rows.map((row) => this.decode(row)).filter((found) => found !== null);
  }

  /** Any live row with this logical key, decodable or not: for fail-closed existence checks. */
  async exists(key: string): Promise<boolean> {
    return (await this.#query({ [ANN.key]: key })).length > 0;
  }

  byKey(key: string): Promise<Found<T> | null> {
    return this.findOne({ [ANN.key]: key });
  }

  validate(payload: unknown): T {
    const parsed = this.codec.schema.safeParse(payload);
    if (!parsed.success) throw invalidPayload(this.codec.type, parsed.error);
    return parsed.data;
  }

  /**
   * New entity, create-if-absent at the ledger (A-32): any live row of this writer with the same logical key —
   * decodable or not, written by this process or another — ⇒ RechargeError('replay'). Exactly one of N
   * concurrent creates of one key succeeds (RT-O-03).
   */
  async create(payload: T): Promise<LedgerPutResult> {
    const valid = this.validate(payload);
    try {
      return await this.ledger.put({
        payload: JSON.stringify(valid),
        annotations: this.annotationsFor(valid),
        expiresIn: this.codec.expiresIn(valid, this.now()),
        ifAbsent: true,
      });
    } catch (error) {
      if (!isConflict(error)) throw error;
      throw new RechargeError(
        'replay',
        `${this.codec.type} ${this.codec.key(valid)} already exists`,
      );
    }
  }

  /** Create, or replace the live entity with the same logical key (lifetime re-derived); CAS-safe. */
  async upsert(payload: T): Promise<LedgerPutResult> {
    const valid = this.validate(payload);
    const key = this.codec.key(valid);
    for (let attempt = 1; ; attempt += 1) {
      try {
        const existing = await this.byKey(key);
        if (!existing) return await this.create(valid);
        const next = await this.replace(existing, valid, this.codec.expiresIn(valid, this.now()));
        return { key: next.entityKey, expiresAt: next.expiresAt };
      } catch (error) {
        // a concurrent create (replay) or update (conflict) of the same key: re-read and write again
        if (!retryable(error) || attempt >= CAS_ATTEMPTS) throw error;
      }
    }
  }

  /**
   * Read-modify-write under compare-and-swap (A-32, RT-O-06): `next` is computed from a FRESH read on every
   * attempt; a concurrent writer makes the attempt fail with a conflict and it is re-run. `next` returning
   * `existing.payload` unchanged (by identity) skips the write. A missing row ⇒ `missing()` is thrown.
   */
  async mutate(
    key: string,
    next: (existing: Found<T>) => { payload: T; expiresIn?: number },
    missing: () => Error,
  ): Promise<Found<T>> {
    for (let attempt = 1; ; attempt += 1) {
      const existing = await this.byKey(key);
      if (!existing) throw missing();
      const out = next(existing);
      if (out.payload === existing.payload) return existing;
      try {
        return await this.replace(existing, out.payload, out.expiresIn);
      } catch (error) {
        if (!isConflict(error) || attempt >= CAS_ATTEMPTS) throw error;
      }
    }
  }

  /** Re-serialise, re-derive annotations; `expiresIn` only when the lifetime changes. CAS on `existing.version`. */
  async replace(existing: Found<T>, next: T, expiresIn?: number): Promise<Found<T>> {
    const valid = this.validate(next);
    const result = await this.ledger.update(
      existing.entityKey,
      {
        payload: JSON.stringify(valid),
        annotations: this.annotationsFor(valid),
        ifVersion: existing.version,
      },
      expiresIn,
    );
    return {
      entityKey: result.key,
      payload: valid,
      expiresAt: result.expiresAt,
      version: existing.version + 1,
    };
  }
}

const retryable = (error: unknown): boolean =>
  isConflict(error) || (error instanceof RechargeError && error.code === 'replay');
