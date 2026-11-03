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
}

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
      ? { entityKey: entity.key, payload: parsed.data, expiresAt: entity.expiresAt }
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

  /** New entity; a live entity with the same logical key already present ⇒ RechargeError('replay'). */
  async create(payload: T): Promise<LedgerPutResult> {
    const valid = this.validate(payload);
    const key = this.codec.key(valid);
    if (await this.byKey(key)) {
      throw new RechargeError('replay', `${this.codec.type} ${key} already exists`);
    }
    return this.ledger.put({
      payload: JSON.stringify(valid),
      annotations: this.annotationsFor(valid),
      expiresIn: this.codec.expiresIn(valid, this.now()),
    });
  }

  /** Create, or replace the live entity with the same logical key (lifetime re-derived). */
  async upsert(payload: T): Promise<LedgerPutResult> {
    const valid = this.validate(payload);
    const existing = await this.byKey(this.codec.key(valid));
    if (!existing) return this.create(valid);
    const next = await this.replace(existing, valid, this.codec.expiresIn(valid, this.now()));
    return { key: next.entityKey, expiresAt: next.expiresAt };
  }

  /** Re-serialise, re-derive annotations; `expiresIn` only when the lifetime changes. */
  async replace(existing: Found<T>, next: T, expiresIn?: number): Promise<Found<T>> {
    const valid = this.validate(next);
    const result = await this.ledger.update(
      existing.entityKey,
      { payload: JSON.stringify(valid), annotations: this.annotationsFor(valid) },
      expiresIn,
    );
    return { entityKey: result.key, payload: valid, expiresAt: result.expiresAt };
  }
}
