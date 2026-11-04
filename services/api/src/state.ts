/**
 * Durable process state (RT-A-11, T-24, T-25): what must survive a restart but cannot go on the world-readable ledger
 * — a pending-profile entitlement's delivery target (its capability key) and the T-24 verified-claim intents (a
 * serve-free decision, capability included). One JSON file at `STATE_FILE`, sealed to SERVER_SEAL_KEY
 * (`sealToServer`) and replaced atomically (write a temp file, then rename) on every change; mode 0600. Without
 * `STATE_FILE` (local mode, tests) it is memory only. Live refuses to boot without it (env.ts). One API writer
 * process per deployment (THREAT-MODEL §8), so the file has one writer.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { openFromServer, sealToServer, utf8, type SealedBox } from '@ethglobal/crypto';

const AAD = utf8('recharge-api-state:v1');

interface Row {
  value: unknown;
  /** ms; null = no expiry. */
  exp: number | null;
}

type Data = Record<string, Record<string, Row>>;

export class DurableState {
  readonly #data: Data;

  constructor(private readonly opts: { file?: string; sealKey: Uint8Array; now: () => number }) {
    this.#data = opts.file !== undefined && existsSync(opts.file) ? this.#load(opts.file) : {};
  }

  /** A namespaced view. Values must be JSON (no bigint). */
  map<V>(namespace: string): DurableMap<V> {
    this.#data[namespace] ??= {};
    return new DurableMap<V>(this.#data[namespace], this.opts.now, () => this.#flush());
  }

  get durable(): boolean {
    return this.opts.file !== undefined;
  }

  #load(file: string): Data {
    try {
      const box = JSON.parse(readFileSync(file, 'utf8')) as SealedBox;
      return JSON.parse(openFromServer(this.opts.sealKey, box, AAD)) as Data;
    } catch {
      // fail closed: a state file we cannot open is never silently replaced by an empty one
      throw new Error(`STATE_FILE ${file} cannot be opened with SERVER_SEAL_KEY`);
    }
  }

  #flush(): void {
    const file = this.opts.file;
    if (file === undefined) return;
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    const sealed = sealToServer(this.opts.sealKey, JSON.stringify(this.#data), AAD);
    writeFileSync(tmp, JSON.stringify(sealed), { mode: 0o600 });
    renameSync(tmp, file);
  }
}

/** A Map-like view over one namespace; expired rows read as absent and are dropped on the next write. */
export class DurableMap<V> {
  constructor(
    private readonly rows: Record<string, Row>,
    private readonly now: () => number,
    private readonly flush: () => void,
  ) {}

  get(key: string): V | undefined {
    const row = this.rows[key];
    return row && this.#live(row) ? (row.value as V) : undefined;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  set(key: string, value: V, expiresAt?: number): void {
    this.#prune();
    this.rows[key] = { value, exp: expiresAt ?? null };
    this.flush();
  }

  delete(key: string): boolean {
    if (!(key in this.rows)) return false;
    delete this.rows[key];
    this.flush();
    return true;
  }

  get size(): number {
    return this.entries().length;
  }

  entries(): [string, V][] {
    return Object.entries(this.rows)
      .filter(([, row]) => this.#live(row))
      .map(([key, row]) => [key, row.value as V]);
  }

  #live(row: Row): boolean {
    return row.exp === null || row.exp > this.now();
  }

  #prune(): void {
    for (const [key, row] of Object.entries(this.rows)) if (!this.#live(row)) delete this.rows[key];
  }
}
