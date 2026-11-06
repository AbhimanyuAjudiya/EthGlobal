/** src/lock.ts and the cross-process parts of src/journal.ts (RT-G-01, RT-G-02, RT-G-03). */
import { appendFile, mkdir, readdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { T0 } from '@ethglobal/adapters/testing';
import { sha256Hex } from '@ethglobal/crypto';
import { dayBucket } from '@ethglobal/protocol/ids';

import { DAY_MS, harness, KEY, seed, tempDir } from './helpers.js';
import { AgentState, ClaimLostError } from '../src/journal.js';
import { FileLock, LOCK_STALE_MS, pidAlive, withFileLock, writeDurable } from '../src/lock.js';
import { tick } from '../src/tick.js';

/** A pid no process has (above Linux pid_max). */
const DEAD_PID = 2_147_483_646;
const fast = { waitMs: 20, sleep: async () => undefined };
const lockBody = (pid: number, nonce: string, at: number) => JSON.stringify({ pid, nonce, at });
const triggerLock = (dir: string, trigger: string) =>
  join(dir, 'triggers', `${sha256Hex(trigger).slice(2)}.lock`);

describe('FileLock', () => {
  it('O_EXCL: one holder at a time; release frees it; held() follows ownership', async () => {
    const path = join(await tempDir(), 'k.lock');
    const a = new FileLock(path, fast);
    const b = new FileLock(path, fast);
    expect(await a.acquire()).toBe(true);
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
      pid: process.pid,
      nonce: a.nonce,
    });
    expect(await b.acquire()).toBe(false); // live holder (this pid), fresh: never broken
    await b.release(); // not b's lock: left in place
    expect(await a.held()).toBe(true);
    await a.release();
    expect(await a.held()).toBe(false);
    expect(await b.acquire()).toBe(true);
  });

  it('a lock whose pid is gone, or older than LOCK_STALE_MS, is broken', async () => {
    const dir = await tempDir();
    const dead = join(dir, 'dead.lock');
    await writeFile(dead, lockBody(DEAD_PID, 'gone', Date.now()));
    expect(pidAlive(DEAD_PID)).toBe(false);
    expect(pidAlive(process.pid)).toBe(true);
    expect(await new FileLock(dead).acquire()).toBe(true);

    const aged = join(dir, 'aged.lock');
    await writeFile(aged, lockBody(process.pid, 'wedged', Date.now() - LOCK_STALE_MS));
    expect(await new FileLock(aged).acquire()).toBe(true);
  });

  it('an empty lock (create in progress) blocks until it is old by mtime', async () => {
    const path = join(await tempDir(), 'empty.lock');
    await writeFile(path, '');
    expect(await new FileLock(path, fast).acquire()).toBe(false);
    const old = new Date(Date.now() - LOCK_STALE_MS - 1_000);
    await utimes(path, old, old);
    expect(await new FileLock(path).acquire()).toBe(true);
  });

  it('release of a lock that is no longer ours restores it instead of deleting it', async () => {
    const path = join(await tempDir(), 'k.lock');
    const again = new FileLock(path, fast);
    expect(await again.acquire()).toBe(true);
    await writeFile(path, lockBody(process.pid, 'someone-else', Date.now())); // displaced meanwhile
    expect(await again.held()).toBe(false);
    await again.release(); // not ours any more: restored, not deleted
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ nonce: 'someone-else' });
  });

  it('withFileLock: undefined when busy; the value otherwise; writeDurable leaves no temp files', async () => {
    const dir = await tempDir();
    const path = join(dir, 'w.lock');
    const holder = new FileLock(path, fast);
    await holder.acquire();
    expect(await withFileLock(path, async () => 1, fast)).toBeUndefined();
    await holder.release();
    expect(await withFileLock(path, async (held) => held(), fast)).toEqual({ value: true });
    await writeDurable(join(dir, 'r.json'), '{"a":1}');
    expect((await readdir(dir)).sort()).toEqual(['r.json']);
  });
});

describe('AgentState across processes', () => {
  it('markSigned refuses unless this instance holds the claim (the payload then never leaves)', async () => {
    const dir = await tempDir();
    const a = new AgentState(dir);
    const b = new AgentState(dir);
    await expect(a.markSigned('t', T0, T0 + 1)).rejects.toBeInstanceOf(ClaimLostError);
    expect(await a.claimTrigger('t', T0)).toEqual({ ok: true });
    await expect(b.markSigned('t', T0, T0 + 1)).rejects.toBeInstanceOf(ClaimLostError);
    // a's claim went stale and b took it over: a must not sign any more
    expect(await b.claimTrigger('t', T0 + 120_000)).toEqual({ ok: true });
    await expect(a.markSigned('t', T0, T0 + 1)).rejects.toBeInstanceOf(ClaimLostError);
    await a.releaseTrigger('t'); // not a's claim: kept
    expect((await a.trigger('t'))?.state).toBe('claimed');
    await b.markSigned('t', T0, T0 + 300_000);
    await b.releaseTrigger('t'); // signed: never released
    expect((await a.trigger('t'))?.state).toBe('signed');
  });

  it('a busy trigger lock fails closed: claim in flight, markSigned/markDone throw', async () => {
    const dir = await tempDir();
    const s = new AgentState(dir, fast);
    await mkdir(join(dir, 'triggers'), { recursive: true });
    const holder = new FileLock(triggerLock(dir, 't'), fast);
    await holder.acquire();
    expect(await s.claimTrigger('t', T0)).toEqual({ ok: false, reason: 'trigger-in-flight' });
    await expect(s.markSigned('t', T0, T0 + 1)).rejects.toBeInstanceOf(ClaimLostError);
    await expect(s.markDone('t', T0)).rejects.toThrow(/lock busy/);
    await holder.release();
  });

  it('own spend — concurrent appends are all counted; a torn line is skipped; a legacy state.json still counts', async () => {
    const dir = await tempDir();
    const a = new AgentState(dir);
    const b = new AgentState(dir);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        (i % 2 ? a : b).recordPurchase({ key: KEY, now: T0, usd6: 1n }),
      ),
    );
    await appendFile(join(dir, 'spent.jsonl'), '{"v":1,"day":');
    expect(await a.spentToday(KEY, T0)).toBe(20n);
    await writeFile(
      join(dir, 'state.json'),
      JSON.stringify({
        v: 1,
        spent: { [String(dayBucket(T0))]: { [sha256Hex(KEY)]: '5' } },
        lastExpiryBought: { [sha256Hex(KEY)]: 7 },
      }),
    );
    expect(await b.spentToday(KEY, T0)).toBe(25n);
    expect(await b.lastExpiryBought(KEY)).toBe(7);
    await b.recordPurchase({ key: KEY, now: T0, usd6: 1n, expiryFor: 9 });
    expect(await b.lastExpiryBought(KEY)).toBe(9);
    expect(await b.own('other', T0)).toEqual({ spentToday: 0n, latestAt: T0 });
  });

  it('RT-G-03 monotonic guard — a purchase on file from the future ⇒ the tick buys nothing (clock-behind)', async () => {
    const h = await harness();
    await seed(h.ledger, h.clock.now, { mbUsed: 900 });
    await h.agent.deps.state.recordPurchase({
      key: 'another-key',
      now: h.clock.now() + DAY_MS,
      usd6: 1n,
    });
    expect((await tick(h.agent.deps, KEY)).skipped).toBe('clock-behind');
    expect(h.signatures()).toBe(0);
  });
});
