/**
 * Cross-process file primitives for AGENT_STATE_DIR (RT-G-01, RT-G-02). Every agent process on one host that shares the
 * directory is serialised by these, not by in-process promise chains:
 *
 * - `writeDurable`: temp file → fsync → rename → fsync(dir). A reader sees the old record or the new one, never half.
 * - `FileLock`: a per-key advisory lock. `open(path, 'wx')` (O_CREAT|O_EXCL) of a file whose content is
 *   `{pid, nonce, at}`, fsynced, then re-read to confirm the content is ours. A lock whose holder is gone (pid not
 *   alive on this host) or that is older than LOCK_STALE_MS is broken by renaming it aside and checking the renamed
 *   content is the one judged stale (if not, it is linked back). `held()` re-reads the lock before a caller reports
 *   success, so a holder that lost its lock to a breaker never acts on what it wrote.
 *
 * Assumes a local POSIX filesystem (rename/link atomic, O_EXCL honoured); AGENT_STATE_DIR on NFS is not supported.
 */
import { randomUUID } from 'node:crypto';
import { link, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

export const isNodeError = (e: unknown, code: string): boolean =>
  e instanceof Error && (e as NodeJS.ErrnoException).code === code;

const ignoreMissing = (error: unknown): void => {
  if (!isNodeError(error, 'ENOENT')) throw error;
};

/** A process-unique id for a lock or claim: pid + a random UUID. */
export const newNonce = (): string => `${process.pid}.${randomUUID()}`;

async function fsyncDir(dir: string): Promise<void> {
  const handle = await open(dir, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Write-then-rename with fsync of the file and its directory: durable before the caller acts on it. */
export async function writeDurable(path: string, text: string): Promise<void> {
  const tmp = `${path}.${newNonce()}.tmp`;
  const handle = await open(tmp, 'wx', 0o600);
  try {
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, path);
  await fsyncDir(dirname(path));
}

/** A lock is never held longer than one record write; past this it is a crashed or wedged holder. */
export const LOCK_STALE_MS = 10_000;
/** How long `acquire` waits for a busy lock before giving up (fail closed: the caller does not proceed). */
export const LOCK_WAIT_MS = 3_000;

interface LockBody {
  pid: number;
  nonce: string;
  at: number;
}

const parseBody = (text: string): LockBody | undefined => {
  try {
    const v = JSON.parse(text) as Partial<LockBody>;
    return typeof v.pid === 'number' && typeof v.nonce === 'string' && typeof v.at === 'number'
      ? (v as LockBody)
      : undefined;
  } catch {
    return undefined;
  }
};

/** true unless the OS says no such process (EPERM ⇒ it exists, owned by someone else). */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNodeError(error, 'ESRCH');
  }
}

const readText = (path: string): Promise<string | undefined> =>
  readFile(path, 'utf8').catch((error: unknown) => {
    ignoreMissing(error);
    return undefined;
  });

export interface LockOptions {
  /** Wall clock for lock ages (real time, independent of the agent's decision clock). */
  wallNow?: () => number;
  sleep?: (ms: number) => Promise<void>;
  waitMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class FileLock {
  readonly nonce = newNonce();
  readonly #wallNow: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #waitMs: number;

  constructor(
    readonly path: string,
    opts: LockOptions = {},
  ) {
    this.#wallNow = opts.wallNow ?? Date.now;
    this.#sleep = opts.sleep ?? defaultSleep;
    this.#waitMs = opts.waitMs ?? LOCK_WAIT_MS;
  }

  /** One O_EXCL attempt: create, write {pid, nonce, at}, fsync, re-read and confirm the content is ours. */
  async tryAcquire(): Promise<boolean> {
    let handle;
    try {
      handle = await open(this.path, 'wx', 0o600);
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) throw error;
      await this.#breakIfStale();
      return false;
    }
    try {
      const body: LockBody = { pid: process.pid, nonce: this.nonce, at: this.#wallNow() };
      await handle.writeFile(JSON.stringify(body));
      await handle.sync();
    } finally {
      await handle.close();
    }
    return this.held();
  }

  /** Retries with a short random backoff until LOCK_WAIT_MS; false ⇒ the caller must not proceed. */
  async acquire(): Promise<boolean> {
    const deadline = this.#wallNow() + this.#waitMs;
    for (;;) {
      if (await this.tryAcquire()) return true;
      if (this.#wallNow() >= deadline) return false;
      // nosemgrep: recharge-math-random-for-secrets — 1–4 ms retry jitter for the lock file, not a secret
      await this.#sleep(1 + Math.floor(Math.random() * 4));
    }
  }

  /** The lock file still carries this holder's nonce. */
  async held(): Promise<boolean> {
    const text = await readText(this.path);
    return text !== undefined && parseBody(text)?.nonce === this.nonce;
  }

  /** Removes the lock only if it is still ours (moved aside first, so a lock someone else took is restored). */
  async release(): Promise<void> {
    await this.#moveAsideIf((body) => body?.nonce === this.nonce);
  }

  async #breakIfStale(): Promise<void> {
    const [text, info] = await Promise.all([
      readText(this.path),
      stat(this.path).catch((error: unknown) => {
        ignoreMissing(error);
        return undefined;
      }),
    ]);
    if (text === undefined || info === undefined) return; // released meanwhile: retry the create
    const body = parseBody(text);
    // an unreadable body is a create in progress (or a crash right after it): only its age can make it stale
    const age = this.#wallNow() - (body?.at ?? info.mtimeMs);
    const stale = age >= LOCK_STALE_MS || (body !== undefined && !pidAlive(body.pid));
    if (!stale) return;
    await this.#moveAsideIf((moved) =>
      body === undefined ? moved === undefined : moved?.nonce === body.nonce,
    );
  }

  /**
   * rename(lock → unique aside name) is atomic, so exactly one caller gets any given lock file. If what it got is not
   * the lock it meant to remove, it links it back (EEXIST ⇒ a newer lock exists; the displaced holder's `held()`
   * then fails and it does not act).
   */
  async #moveAsideIf(expected: (body: LockBody | undefined) => boolean): Promise<void> {
    const aside = `${this.path}.${newNonce()}.aside`;
    try {
      await rename(this.path, aside);
    } catch (error) {
      ignoreMissing(error);
      return;
    }
    const text = await readText(aside);
    if (!expected(text === undefined ? undefined : parseBody(text))) {
      await link(aside, this.path).catch((error: unknown) => {
        if (!isNodeError(error, 'EEXIST')) throw error;
      });
    }
    await unlink(aside).catch(ignoreMissing);
  }
}

/**
 * Runs `fn` under the lock at `path`. `fn` gets `held()` to confirm, after its writes, that it still owned the lock
 * throughout. Returns `undefined` when the lock could not be taken within the wait.
 */
export async function withFileLock<T>(
  path: string,
  fn: (held: () => Promise<boolean>) => Promise<T>,
  opts: LockOptions = {},
): Promise<{ value: T } | undefined> {
  const lock = new FileLock(path, opts);
  if (!(await lock.acquire())) return undefined;
  try {
    return { value: await fn(() => lock.held()) };
  } finally {
    await lock.release();
  }
}
