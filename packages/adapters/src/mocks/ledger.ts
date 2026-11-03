import { AdapterError } from '../errors.js';
import {
  annotationAlive,
  assertExpiresIn,
  assertLimit,
  matchesAnnotations,
} from '../ledger-rules.js';

import type {
  Annotations,
  Ledger,
  LedgerEntity,
  LedgerPutInput,
  LedgerPutResult,
  LedgerQuery,
} from '../types.js';

export interface InMemoryLedgerOptions {
  /** Clock in ms since epoch; inject a fake one for deterministic expiry. */
  now?: () => number;
  /**
   * The writer identity (Arkiv `$creator`) this view writes as and trusts. Reads only ever return entities
   * created by it, exactly as ArkivLedger filters on `$creator` (T-79). Default `'local'`.
   */
  writer?: string;
}

interface Stored extends LedgerEntity {
  creator: string;
}

interface Store {
  entities: Map<string, Stored>;
  sequence: number;
}

/**
 * Deterministic in-memory entity store: sequential keys `ent_000001…` (entity keys are the ledger's; logical keys
 * live in the `key` annotation, T-36), expiry from the injected clock, and a numeric `expiresAt` annotation
 * honoured as a second clock (T-35). Writer-aware: `asWriter(addr)` is a view over the same store that writes
 * as another account — its entities are invisible to every other writer's reads (T-79).
 */
export class InMemoryLedger implements Ledger {
  readonly #store: Store;
  readonly #now: () => number;
  readonly #writer: string;

  constructor(options: InMemoryLedgerOptions = {}, store?: Store) {
    this.#now = options.now ?? Date.now;
    this.#writer = (options.writer ?? 'local').toLowerCase();
    this.#store = store ?? { entities: new Map(), sequence: 0 };
  }

  /** A view over the same entities that writes (and trusts) as `writer`. */
  asWriter(writer: string): InMemoryLedger {
    return new InMemoryLedger({ now: this.#now, writer }, this.#store);
  }

  async put(input: LedgerPutInput): Promise<LedgerPutResult> {
    assertExpiresIn(input.expiresIn);
    this.#store.sequence += 1;
    const key = `ent_${String(this.#store.sequence).padStart(6, '0')}`;
    const createdAt = this.#now();
    const expiresAt = input.expiresIn === undefined ? null : createdAt + input.expiresIn * 1000;
    this.#store.entities.set(key, {
      key,
      payload: input.payload,
      annotations: { ...(input.annotations ?? {}) },
      createdAt,
      expiresAt,
      creator: this.#writer,
    });
    return { key, expiresAt };
  }

  /** Replaces payload and/or annotations in place (the key is stable here); keeps createdAt. */
  async update(
    key: string,
    patch: { payload?: string; annotations?: Annotations },
    expiresIn?: number,
  ): Promise<LedgerPutResult> {
    assertExpiresIn(expiresIn);
    const entity = this.#live(key);
    if (!entity) throw new AdapterError('ledger', 'not_found', `no live entity ${key}`);
    if (patch.payload !== undefined) entity.payload = patch.payload;
    if (patch.annotations !== undefined) entity.annotations = { ...patch.annotations };
    if (expiresIn !== undefined) entity.expiresAt = this.#now() + expiresIn * 1000;
    return { key, expiresAt: entity.expiresAt };
  }

  async get(key: string): Promise<LedgerEntity | null> {
    const entity = this.#live(key);
    return entity ? copy(entity) : null;
  }

  async query(query: LedgerQuery = {}): Promise<LedgerEntity[]> {
    assertLimit(query.limit);
    const wanted = query.annotations ?? {};
    const matches = [...this.#store.entities.values()]
      .filter((entity) => this.#isVisible(entity) && matchesAnnotations(entity, wanted))
      .sort((a, b) => a.createdAt - b.createdAt || a.key.localeCompare(b.key));
    const limited = query.limit === undefined ? matches : matches.slice(0, query.limit);
    return limited.map(copy);
  }

  #live(key: string): Stored | undefined {
    const entity = this.#store.entities.get(key);
    return entity && this.#isVisible(entity) ? entity : undefined;
  }

  #isVisible(entity: Stored): boolean {
    const now = this.#now();
    return (
      entity.creator === this.#writer &&
      (entity.expiresAt === null || entity.expiresAt > now) &&
      annotationAlive(entity.annotations, now)
    );
  }
}

function copy({ creator: _creator, ...entity }: Stored): LedgerEntity {
  return structuredClone(entity);
}
