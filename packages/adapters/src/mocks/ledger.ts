import { AdapterError } from '../errors.js';

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
}

/** Deterministic in-memory entity store: sequential keys, expiry from the injected clock. */
export class InMemoryLedger implements Ledger {
  readonly #entities = new Map<string, LedgerEntity>();
  readonly #now: () => number;
  #sequence = 0;

  constructor(options: InMemoryLedgerOptions = {}) {
    this.#now = options.now ?? Date.now;
  }

  async put(input: LedgerPutInput): Promise<LedgerPutResult> {
    assertExpiresIn(input.expiresIn);
    this.#sequence += 1;
    const key = `ent_${String(this.#sequence).padStart(6, '0')}`;
    const createdAt = this.#now();
    const expiresAt = input.expiresIn === undefined ? null : createdAt + input.expiresIn * 1000;
    this.#entities.set(key, {
      key,
      payload: input.payload,
      annotations: { ...(input.annotations ?? {}) },
      createdAt,
      expiresAt,
    });
    return { key, expiresAt };
  }

  /** Replaces payload and/or annotations in place (the key is stable here; Arkiv may assign a new one). */
  async update(
    key: string,
    patch: { payload?: string; annotations?: Annotations },
    expiresIn?: number,
  ): Promise<LedgerPutResult> {
    assertExpiresIn(expiresIn);
    const entity = this.#entities.get(key);
    if (!entity || !this.#isLive(entity)) {
      throw new AdapterError('ledger', 'not_found', `no live entity ${key}`);
    }
    if (patch.payload !== undefined) entity.payload = patch.payload;
    if (patch.annotations !== undefined) entity.annotations = { ...patch.annotations };
    if (expiresIn !== undefined) entity.expiresAt = this.#now() + expiresIn * 1000;
    return { key, expiresAt: entity.expiresAt };
  }

  async get(key: string): Promise<LedgerEntity | null> {
    const entity = this.#entities.get(key);
    return entity && this.#isLive(entity) ? structuredClone(entity) : null;
  }

  async query(query: LedgerQuery = {}): Promise<LedgerEntity[]> {
    const wanted = Object.entries(query.annotations ?? {});
    const matches = [...this.#entities.values()]
      .filter((entity) => this.#isLive(entity))
      .filter((entity) => wanted.every(([name, value]) => entity.annotations[name] === value))
      .sort((a, b) => a.createdAt - b.createdAt || a.key.localeCompare(b.key));
    const limited =
      query.limit === undefined ? matches : matches.slice(0, Math.max(0, query.limit));
    return limited.map((entity) => structuredClone(entity));
  }

  #isLive(entity: LedgerEntity): boolean {
    return entity.expiresAt === null || entity.expiresAt > this.#now();
  }
}

function assertExpiresIn(expiresIn: number | undefined): void {
  if (expiresIn !== undefined && !(Number.isInteger(expiresIn) && expiresIn > 0)) {
    throw new AdapterError(
      'ledger',
      'invalid_expiry',
      'expiresIn must be a positive integer (seconds)',
    );
  }
}
