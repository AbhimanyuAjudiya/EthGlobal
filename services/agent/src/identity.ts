/**
 * The agent's HCS-14 UAID (A-29; agent.md §5). Computed with `hcs14Uaid` from `@ethglobal/adapters/live` (the one
 * implementation; injected here so this module never re-implements it), persisted to `<stateDir>/uaid`, sent as
 * `X-Agent-Uaid` and carried by every HCS `agent-topup` receipt. AGENT_UAID overrides. Registration in an HCS-14
 * registry is not done in v0 ("HCS-14 registration minimal", DECISION §6.6).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Hcs14Input } from '@ethglobal/adapters/live';

import type { Log } from './log.js';

/** Keep equal to package.json "version" (a test asserts it). */
export const AGENT_VERSION = '0.1.0';
export const AGENT_NAME = 'recharge-topup-agent';
/** nativeId in local mode: no Hedera account exists there; 0.0.0 keeps the CAIP-10 form hcs14Uaid requires. */
export const LOCAL_NATIVE_ACCOUNT = '0.0.0';

export type { Hcs14Input };
export type Hcs14Fn = (input: Hcs14Input) => string;

export function uaidInput(hederaAccountId: string | undefined): Hcs14Input {
  return {
    registry: 'hedera',
    name: AGENT_NAME,
    version: AGENT_VERSION,
    protocol: 'x402',
    nativeId: `hedera:testnet:${hederaAccountId ?? LOCAL_NATIVE_ACCOUNT}`,
    // HCS-14 skills are sorted integers (A-29); the human-readable capabilities are in the README.
    skills: [],
  };
}

export async function resolveUaid(opts: {
  stateDir: string;
  override?: string;
  hederaAccountId?: string;
  compute: Hcs14Fn;
  log: Log;
}): Promise<string> {
  if (opts.override !== undefined) return opts.override;
  const computed = opts.compute(uaidInput(opts.hederaAccountId));
  const file = join(opts.stateDir, 'uaid');
  const stored = await readFile(file, 'utf8').then(
    (s) => s.trim(),
    () => undefined,
  );
  if (stored !== computed) {
    if (stored !== undefined)
      opts.log.warn({ stored, computed }, 'agent: UAID changed; replacing .agent/uaid');
    await mkdir(opts.stateDir, { recursive: true });
    await writeFile(file, `${computed}\n`, { mode: 0o600 });
    opts.log.info({ uaid: computed }, 'agent: UAID');
  }
  return computed;
}
