/**
 * The agent's own memory under AGENT_STATE_DIR (git-ignored; AG7): `journal.jsonl` (one line per decision, read by the
 * demo screen), `state.json` (spent today, lastExpiryBought) and `triggers/` (one file per purchase trigger, created
 * exclusively before any signature — T-57: a crash, a restart or a second process never signs twice for one trigger).
 * Entitlement keys are capabilities (T-73), so nothing here stores one in clear: only sha256(key).
 */
import { mkdir, open, readFile, rename, unlink, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { sha256Hex } from '@ethglobal/crypto';
import { dayBucket } from '@ethglobal/protocol/ids';

const isNodeError = (e: unknown, code: string): boolean =>
  e instanceof Error && (e as NodeJS.ErrnoException).code === code;

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    if (isNodeError(error, 'ENOENT') || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

/** Write-then-rename so a crash never leaves half a file. */
async function writeAtomic(path: string, text: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, text, { mode: 0o600 });
  await rename(tmp, path);
}

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
    try {
      const text = await readFile(this.#file, 'utf8');
      return text
        .split('\n')
        .filter((l) => l !== '')
        .map((l) => JSON.parse(l) as Record<string, unknown>);
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return [];
      throw error;
    }
  }
}

const stateSchema = z.object({
  v: z.literal(1),
  /** day bucket → sha256(key) → usd6 digits spent by this agent (its own record; AG1.3 receipt lag). */
  spent: z.record(z.string(), z.record(z.string(), z.string().regex(/^\d{1,30}$/))).default({}),
  /** sha256(key) → the expiresAt an expiry purchase was made for (T-30, once per expiresAt). */
  lastExpiryBought: z.record(z.string(), z.int().nonnegative()).default({}),
});
type State = z.infer<typeof stateSchema>;

const triggerSchema = z.object({
  state: z.enum(['claimed', 'signed', 'done']),
  at: z.int().nonnegative(),
  /** ms; after it the signed authorization can no longer settle, so a fresh signature is safe (EIP-3009 / Hedera validity). */
  validBefore: z.int().nonnegative().optional(),
});
export type TriggerRecord = z.infer<typeof triggerSchema>;

export type ClaimResult =
  { ok: true } | { ok: false; reason: 'already-bought-for-trigger' | 'trigger-in-flight' };

/** A claim nobody turned into a signature within this window is stale (the process died before signing). */
export const STALE_CLAIM_MS = 120_000;

export class AgentState {
  readonly #file: string;
  readonly #triggers: string;
  #chain: Promise<unknown> = Promise.resolve();

  constructor(readonly dir: string) {
    this.#file = join(dir, 'state.json');
    this.#triggers = join(dir, 'triggers');
  }

  /** Serialises read-modify-write of state.json inside this process. */
  #locked<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#chain.then(fn, fn);
    this.#chain = run.catch(() => undefined);
    return run;
  }

  async #load(): Promise<State> {
    const parsed = stateSchema.safeParse((await readJson(this.#file)) ?? { v: 1 });
    return parsed.success ? parsed.data : { v: 1, spent: {}, lastExpiryBought: {} };
  }

  async #save(state: State): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeAtomic(this.#file, JSON.stringify(state));
  }

  async spentToday(key: string, now: number): Promise<bigint> {
    const state = await this.#load();
    return BigInt(state.spent[String(dayBucket(now))]?.[sha256Hex(key)] ?? '0');
  }

  async lastExpiryBought(key: string): Promise<number | undefined> {
    return (await this.#load()).lastExpiryBought[sha256Hex(key)];
  }

  /** Records a settled purchase: adds to today's spend, and pins lastExpiryBought for an expiry purchase. */
  recordPurchase(input: {
    key: string;
    now: number;
    usd6: bigint;
    expiryFor?: number;
  }): Promise<void> {
    return this.#locked(async () => {
      const state = await this.#load();
      const day = String(dayBucket(input.now));
      const ent = sha256Hex(input.key);
      const today = state.spent[day] ?? {};
      today[ent] = (BigInt(today[ent] ?? '0') + input.usd6).toString();
      // keep only the current UTC day (the cap is per UTC day, T-30)
      state.spent = { [day]: today };
      if (input.expiryFor !== undefined) state.lastExpiryBought[ent] = input.expiryFor;
      await this.#save(state);
    });
  }

  #triggerPath(triggerKey: string): string {
    return join(this.#triggers, `${sha256Hex(triggerKey).slice(2)}.json`);
  }

  async trigger(triggerKey: string): Promise<TriggerRecord | undefined> {
    const parsed = triggerSchema.safeParse(await readJson(this.#triggerPath(triggerKey)));
    return parsed.success ? parsed.data : undefined;
  }

  /**
   * Exclusive claim before signing (O_EXCL create): exactly one tick in one process wins per trigger. An existing
   * record blocks unless it is provably dead: a 'signed' record whose authorization has expired, or a stale 'claimed'.
   */
  async claimTrigger(triggerKey: string, now: number): Promise<ClaimResult> {
    await mkdir(this.#triggers, { recursive: true });
    const path = this.#triggerPath(triggerKey);
    const record: TriggerRecord = { state: 'claimed', at: now };
    try {
      const handle = await open(path, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(record));
      await handle.close();
      return { ok: true };
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) throw error;
    }
    const existing = await this.trigger(triggerKey);
    if (existing?.state === 'done') return { ok: false, reason: 'already-bought-for-trigger' };
    const dead =
      existing === undefined ||
      (existing.state === 'signed' &&
        existing.validBefore !== undefined &&
        now >= existing.validBefore) ||
      (existing.state === 'claimed' && now - existing.at >= STALE_CLAIM_MS);
    if (!dead) return { ok: false, reason: 'trigger-in-flight' };
    await writeAtomic(path, JSON.stringify(record));
    return { ok: true };
  }

  async markSigned(triggerKey: string, now: number, validBefore: number): Promise<void> {
    await writeAtomic(
      this.#triggerPath(triggerKey),
      JSON.stringify({ state: 'signed', at: now, validBefore } satisfies TriggerRecord),
    );
  }

  async markDone(triggerKey: string, now: number): Promise<void> {
    await writeAtomic(
      this.#triggerPath(triggerKey),
      JSON.stringify({ state: 'done', at: now } satisfies TriggerRecord),
    );
  }

  /** No signature was produced: the trigger may be retried on the next tick. */
  async releaseTrigger(triggerKey: string): Promise<void> {
    await unlink(this.#triggerPath(triggerKey)).catch((error: unknown) => {
      if (!isNodeError(error, 'ENOENT')) throw error;
    });
  }
}
