/**
 * Red-team verification variant for RT-G-01 (cross-process trigger claim: O_EXCL lock + confirm, stale-lock break by
 * rename): the regression races TWO processes on 300 triggers, unloaded. Here: THREE processes on one AGENT_STATE_DIR,
 * while every core is saturated by busy-loop processes (scheduler preemption inside the claim / confirm windows), for
 * VERIFY_G01_ROUNDS rounds (default 3; the red team ran the two-process race 500× under load, see RT-G-01.md).
 * Property: no trigger is won by two processes.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { tempDir } from '../helpers.js';

const TSX = join(import.meta.dirname, '../../node_modules/.bin/tsx');
const WORKER = join(import.meta.dirname, 'rt-proc-worker.ts');
const ROUNDS = Number(process.env.VERIFY_G01_ROUNDS ?? '3');
const TRIGGERS = 200;

const worker = (dir: string, startAt: number): Promise<number[]> =>
  new Promise((resolve, reject) => {
    execFile(
      TSX,
      [WORKER, 'claim', dir, String(TRIGGERS), String(startAt)],
      { timeout: 110_000 },
      (err, out) =>
        err
          ? reject(new Error(String(err.message), { cause: err }))
          : resolve(JSON.parse(out) as number[]),
    );
  });

let burners: ChildProcess[] = [];

describe('verify RT-G-01: three agent processes under CPU saturation', () => {
  beforeAll(() => {
    burners = Array.from({ length: availableParallelism() }, () =>
      spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore' }),
    );
  });
  afterAll(() => {
    for (const b of burners) b.kill('SIGKILL');
  });

  it(
    `${ROUNDS} round(s) × 3 processes × ${TRIGGERS} triggers ⇒ no trigger won twice`,
    async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const dir = await tempDir();
        const startAt = Date.now() + 2_500;
        const won = await Promise.all([
          worker(dir, startAt),
          worker(dir, startAt),
          worker(dir, startAt),
        ]);
        const seen = new Map<number, number>();
        for (const list of won) for (const i of list) seen.set(i, (seen.get(i) ?? 0) + 1);
        const twice = [...seen].filter(([, n]) => n > 1).map(([i]) => i);
        expect(twice).toEqual([]);
      }
    },
    120_000 * Math.max(1, ROUNDS),
  );
});
