/**
 * The agent's own memory under AGENT_STATE_DIR (git-ignored; AG7): `journal.jsonl` (one line per decision, read by the
 * demo screen), `spent.jsonl` (one line per settled purchase — the own-spend journal) and `triggers/` (one record per
 * purchase trigger, claimed under a per-trigger file lock before any signature — T-57: a crash, a restart or a second
 * process never signs twice for one trigger). Entitlement keys are capabilities (T-73): only sha256(key) is stored.
 *
 * Several agent processes may share the directory (RT-G-01, RT-G-02): nothing here relies on in-process ordering.
 * - Triggers: every read-decide-write of a trigger record happens under `triggers/<h>.lock` (src/lock.ts); the record
 *   names its claimant (`by`), the signed marker is fsynced before the payload leaves, and `markSigned` refuses (so the
 *   payload never leaves) unless this instance still holds the claim.
 * - Own spend: an append-only journal (O_APPEND, one write per line, fsync) reduced on read. Concurrent appends never
 *   lose a line, and a purchase is filed under the UTC day it was made, so a clock step never evicts another day
 *   (RT-G-03). `latestAt` lets the caller notice a clock that went backwards.
 */
import { appendFile, mkdir, open, readFile, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { sha256Hex } from '@ethglobal/crypto';
import { dayBucket } from '@ethglobal/protocol/ids';
import { paymentPayloadSchema } from '@ethglobal/protocol/schemas';

import { isNodeError, newNonce, withFileLock, writeDurable, type LockOptions } from './lock.js';

const readTextOrUndefined = (path: string): Promise<string | undefined> =>
  readFile(path, 'utf8').catch((error: unknown) => {
    if (isNodeError(error, 'ENOENT')) return undefined;
    throw error;
  });

const jsonLines = (text: string): unknown[] =>
  text
    .split('\n')
    .filter((l) => l !== '')
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as unknown];
      } catch {
        return []; // a torn last line after a crash: that append never completed
      }
    });

/** Append-only decision log. Values are numbers, enums and hashes only. */
export class Journal {
  readonly #file: string;

  constructor(readonly dir: string) {
    this.#file = join(dir, 'journal.jsonl');
  }

  async write(line: Record<string, unknown>): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const text = JSON.stringify(line, (_k, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    await appendFile(this.#file, `${text}\n`, { mode: 0o600 });
  }

  async read(): Promise<Record<string, unknown>[]> {
    const text = await readTextOrUndefined(this.#file);
    return text === undefined ? [] : (jsonLines(text) as Record<string, unknown>[]);
  }
}

/** One settled purchase in `spent.jsonl`. */
const spendSchema = z.object({
  v: z.literal(1),
  /** UTC day bucket of the purchase (the cap is per UTC day, T-30). */
  day: z.int().nonnegative(),
  /** sha256(key) */
  ent: z.string(),
  usd6: z.string().regex(/^\d{1,30}$/),
  at: z.int().nonnegative(),
  /** the expiresAt an expiry purchase was made for (T-30, once per expiresAt) */
  expiryFor: z.int().nonnegative().optional(),
  purchaseId: z.string().optional(),
});

/** The pre-journal `state.json` (read only, so an upgrade keeps what an older agent recorded). */
const legacyStateSchema = z.object({
  v: z.literal(1),
  spent: z.record(z.string(), z.record(z.string(), z.string().regex(/^\d{1,30}$/))).default({}),
  lastExpiryBought: z.record(z.string(), z.int().nonnegative()).default({}),
});

export interface OwnRecord {
  /** usd6 this agent (all processes on this directory) paid for `key` in the UTC day of `now`. */
  spentToday: bigint;
  /** The newest expiresAt an expiry purchase was made for. */
  lastExpiryBought?: number;
  /** The newest purchase time on file, any key: `now` far below it means the clock went backwards. */
  latestAt?: number;
}

export const pendingPaymentSchema = z.object({
  ent: z.string(),
  mb: z.int().positive(),
  reason: z.enum(['threshold', 'expiry']),
  expectedUsd6: z.string().regex(/^\d{1,30}$/),
  expiresAt: z.int().nonnegative(),
  mbTotalBefore: z.int().nonnegative(),
  signedAt: z.int().nonnegative(),
  payload: paymentPayloadSchema,
});
export type PendingPayment = z.infer<typeof pendingPaymentSchema>;

const triggerSchema = z.object({
  state: z.enum(['claimed', 'signed', 'done']),
  at: z.int().nonnegative(),
  /** Authorization deadline in ms. Passing it does not prove the payment did not settle earlier. */
  validBefore: z.int().nonnegative().optional(),
  /** The claimant's nonce (pid + UUID): only it may mark the trigger signed or release it. */
  by: z.string().max(80).optional(),
  payment: pendingPaymentSchema.optional(),
});
export type TriggerRecord = z.infer<typeof triggerSchema>;

export type ClaimResult =
  { ok: true } | { ok: false; reason: 'already-bought-for-trigger' | 'trigger-in-flight' };

/** A claim nobody turned into a signature within this window is stale (the process died before signing). */
export const STALE_CLAIM_MS = 120_000;

/** Thrown by markSigned when this instance no longer holds the claim: the payload must not leave. */
export class ClaimLostError extends Error {
  override readonly name = 'ClaimLostError';
}

type Existing =
  | { kind: 'missing' }
  | { kind: 'unreadable'; mtimeMs: number }
  | { kind: 'record'; record: TriggerRecord };

export class AgentState {
  readonly #spent: string;
  readonly #legacy: string;
  readonly #triggers: string;
  /** This instance's identity on the claims it writes. */
  readonly #id = newNonce();
  readonly #lock: LockOptions;
  readonly #wallNow: () => number;

  constructor(
    readonly dir: string,
    opts: LockOptions = {},
  ) {
    this.#spent = join(dir, 'spent.jsonl');
    this.#legacy = join(dir, 'state.json');
    this.#triggers = join(dir, 'triggers');
    this.#lock = opts;
    this.#wallNow = opts.wallNow ?? Date.now;
  }

  /** Reduces `spent.jsonl` (plus a legacy `state.json`) for one key. */
  async own(key: string, now: number): Promise<OwnRecord> {
    const ent = sha256Hex(key);
    const day = dayBucket(now);
    const [text, legacyText] = await Promise.all([
      readTextOrUndefined(this.#spent),
      readTextOrUndefined(this.#legacy),
    ]);
    let spentToday = 0n;
    let lastExpiryBought: number | undefined;
    let latestAt: number | undefined;
    const purchases = new Set<string>();
    for (const raw of jsonLines(text ?? '')) {
      const line = spendSchema.safeParse(raw);
      if (!line.success) continue;
      const p = line.data;
      if (p.purchaseId !== undefined) {
        if (purchases.has(p.purchaseId)) continue;
        purchases.add(p.purchaseId);
      }
      latestAt = Math.max(latestAt ?? 0, p.at);
      if (p.ent !== ent) continue;
      if (p.day === day) spentToday += BigInt(p.usd6);
      if (p.expiryFor !== undefined)
        lastExpiryBought = Math.max(lastExpiryBought ?? 0, p.expiryFor);
    }
    const legacy = legacyStateSchema.safeParse(parseOrUndefined(legacyText));
    if (legacy.success) {
      spentToday += BigInt(legacy.data.spent[String(day)]?.[ent] ?? '0');
      const exp = legacy.data.lastExpiryBought[ent];
      if (exp !== undefined) lastExpiryBought = Math.max(lastExpiryBought ?? 0, exp);
    }
    return {
      spentToday,
      ...(lastExpiryBought === undefined ? {} : { lastExpiryBought }),
      ...(latestAt === undefined ? {} : { latestAt }),
    };
  }

  async spentToday(key: string, now: number): Promise<bigint> {
    return (await this.own(key, now)).spentToday;
  }

  async lastExpiryBought(key: string): Promise<number | undefined> {
    return (await this.own(key, 0)).lastExpiryBought;
  }

  /**
   * Records a settled purchase: one fsynced O_APPEND write of one line (atomic against other appenders on a local
   * filesystem), filed under the UTC day of `now`. Nothing is ever rewritten or evicted (a line is ≈ 200 bytes and
   * the daily cap bounds lines per key per day, so the file stays small).
   */
  async recordPurchase(input: {
    key: string;
    now: number;
    usd6: bigint;
    expiryFor?: number;
    purchaseId?: string;
  }): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const line = JSON.stringify({
      v: 1,
      day: dayBucket(input.now),
      ent: sha256Hex(input.key),
      usd6: input.usd6.toString(),
      at: input.now,
      ...(input.expiryFor === undefined ? {} : { expiryFor: input.expiryFor }),
      ...(input.purchaseId === undefined ? {} : { purchaseId: input.purchaseId }),
    } satisfies z.infer<typeof spendSchema>);
    const handle = await open(this.#spent, 'a', 0o600);
    try {
      // leading newline: a line torn by a crash never swallows the next record
      await handle.write(`\n${line}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  #triggerPath(triggerKey: string): string {
    return join(this.#triggers, `${sha256Hex(triggerKey).slice(2)}.json`);
  }

  async #existing(path: string): Promise<Existing> {
    const text = await readTextOrUndefined(path);
    if (text === undefined) return { kind: 'missing' };
    const parsed = triggerSchema.safeParse(parseOrUndefined(text));
    if (parsed.success) return { kind: 'record', record: parsed.data };
    const info = await stat(path);
    return { kind: 'unreadable', mtimeMs: info.mtimeMs };
  }

  async trigger(triggerKey: string): Promise<TriggerRecord | undefined> {
    const found = await this.#existing(this.#triggerPath(triggerKey));
    return found.kind === 'record' ? found.record : undefined;
  }

  /** An unresolved authorization must be reconciled before signing any other trigger for this plan. */
  async pending(
    key: string,
  ): Promise<{ trigger: string; payment: PendingPayment; validBefore: number } | undefined> {
    const files = await readdir(this.#triggers).catch((error: unknown) => {
      if (isNodeError(error, 'ENOENT')) return [];
      throw error;
    });
    const ent = sha256Hex(key);
    for (const file of files.filter((f) => /^[a-f0-9]{64}\.json$/.test(f))) {
      const existing = await this.#existing(join(this.#triggers, file));
      if (existing.kind !== 'record' || existing.record.state !== 'signed') continue;
      const { payment, validBefore } = existing.record;
      if (payment?.ent !== ent || validBefore === undefined) continue;
      const trigger =
        payment.reason === 'expiry'
          ? `${key}:expiry:${payment.expiresAt}`
          : `${key}:threshold:${payment.mbTotalBefore}`;
      if (this.#triggerPath(trigger) !== join(this.#triggers, file)) continue;
      return { trigger, payment, validBefore };
    }
    return undefined;
  }

  /** Runs `fn` under the trigger's lock; `undefined` when the lock is busy past LOCK_WAIT_MS. */
  async #underLock<T>(
    triggerKey: string,
    fn: (path: string, held: () => Promise<boolean>) => Promise<T>,
  ): Promise<{ value: T } | undefined> {
    await mkdir(this.#triggers, { recursive: true });
    const path = this.#triggerPath(triggerKey);
    return withFileLock(
      `${path.slice(0, -'.json'.length)}.lock`,
      (held) => fn(path, held),
      this.#lock,
    );
  }

  #dead(existing: Existing, now: number): boolean {
    switch (existing.kind) {
      case 'missing':
        return true;
      case 'unreadable':
        // a record someone is writing (or a torn one): in flight until it is old by its mtime (wall clock)
        return this.#wallNow() - existing.mtimeMs >= STALE_CLAIM_MS;
      case 'record': {
        const r = existing.record;
        // Expiration proves only that it cannot settle in the future, not that it did not
        // already settle before a dropped response or failed fulfillment.
        if (r.state === 'signed') return false;
        return r.state === 'claimed' && now - r.at >= STALE_CLAIM_MS;
      }
    }
  }

  /**
   * Exclusive claim before signing: under the trigger lock, read the record and take it only if it is missing or
   * provably dead (a stale unsigned 'claimed' record, or an unreadable one older than
   * STALE_CLAIM_MS). The claim is durable and the lock confirmed still ours before `ok` is returned.
   */
  async claimTrigger(triggerKey: string, now: number): Promise<ClaimResult> {
    const result = await this.#underLock(triggerKey, async (path, held): Promise<ClaimResult> => {
      const existing = await this.#existing(path);
      if (existing.kind === 'record' && existing.record.state === 'done')
        return { ok: false, reason: 'already-bought-for-trigger' };
      if (!this.#dead(existing, now)) return { ok: false, reason: 'trigger-in-flight' };
      await writeDurable(path, JSON.stringify({ state: 'claimed', at: now, by: this.#id }));
      return (await held()) ? { ok: true } : { ok: false, reason: 'trigger-in-flight' };
    });
    return result?.value ?? { ok: false, reason: 'trigger-in-flight' };
  }

  /**
   * The signed marker, fsynced BEFORE the payload leaves (crash safety, AG3.3). Throws ClaimLostError — and so stops
   * the send — unless this instance still holds a 'claimed' record for the trigger under the lock.
   */
  async markSigned(
    triggerKey: string,
    now: number,
    validBefore: number,
    payment?: PendingPayment,
  ): Promise<void> {
    const result = await this.#underLock(triggerKey, async (path, held) => {
      const existing = await this.#existing(path);
      const mine =
        existing.kind === 'record' &&
        existing.record.state === 'claimed' &&
        existing.record.by === this.#id;
      if (!mine) return false;
      const record: TriggerRecord = {
        state: 'signed',
        at: now,
        validBefore,
        by: this.#id,
        ...(payment ? { payment: pendingPaymentSchema.parse(payment) } : {}),
      };
      await writeDurable(path, JSON.stringify(record));
      return held();
    });
    if (result?.value !== true) throw new ClaimLostError('trigger claim lost before signing');
  }

  /** Settled: the trigger never fires again. Written under the lock; throws if the lock cannot be taken. */
  async markDone(triggerKey: string, now: number): Promise<void> {
    const result = await this.#underLock(triggerKey, (path) =>
      writeDurable(path, JSON.stringify({ state: 'done', at: now } satisfies TriggerRecord)),
    );
    if (result === undefined) throw new Error('trigger lock busy: could not mark done');
  }

  /** Append spend before marking done; purchaseId makes a crash between the two writes harmless. */
  async completePurchase(
    triggerKey: string,
    input: { key: string; now: number; usd6: bigint; expiryFor?: number },
  ): Promise<boolean> {
    const result = await this.#underLock(triggerKey, async (path) => {
      const existing = await this.#existing(path);
      if (existing.kind === 'record' && existing.record.state === 'done') return false;
      await this.recordPurchase({ ...input, purchaseId: sha256Hex(triggerKey) });
      await writeDurable(
        path,
        JSON.stringify({ state: 'done', at: input.now } satisfies TriggerRecord),
      );
      return true;
    });
    if (result === undefined) throw new Error('trigger lock busy: could not record purchase');
    return result.value;
  }

  /** No signature was produced: the trigger may be retried on the next tick. Only the claimant releases its claim. */
  async releaseTrigger(triggerKey: string): Promise<void> {
    await this.#underLock(triggerKey, async (path) => {
      const existing = await this.#existing(path);
      if (existing.kind !== 'record' || existing.record.by !== this.#id) return;
      if (existing.record.state !== 'claimed') return;
      await unlink(path);
    });
  }
}

function parseOrUndefined(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
