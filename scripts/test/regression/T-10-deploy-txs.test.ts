/**
 * THREAT-MODEL T-10 (the deploy record the drill trusts) — regression for RT-P-12: `pnpm deploy:txs`
 * (packages/contracts/script/fill-deploy-txs.mjs) accepts only a chains.json key with a [a-z0-9_] slug, writes only
 * inside deploy/, and records owner()/pendingOwner() only from an RPC whose eth_chainId equals CHAIN.
 * Runs a copy of the script in a scratch tree with a fake `cast` on PATH (no chain, no network).
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const SCRIPT = join(ROOT, 'packages/contracts/script/fill-deploy-txs.mjs');
const DD = '0x1111111111111111111111111111111111111111';
const OWNER = '0x2222222222222222222222222222222222222222';

let dir = '';
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function tree(chains: unknown, chainId = '31337') {
  dir = mkdtempSync(join(tmpdir(), 'rt10-'));
  const t = join(dir, 'contracts');
  mkdirSync(join(t, 'script'), { recursive: true });
  mkdirSync(join(t, 'deploy'));
  mkdirSync(join(t, 'broadcast/Deploy.s.sol', chainId), { recursive: true });
  copyFileSync(SCRIPT, join(t, 'script/fill-deploy-txs.mjs'));
  writeFileSync(join(t, 'deploy/chains.json'), JSON.stringify(chains));
  writeFileSync(
    join(t, 'broadcast/Deploy.s.sol', chainId, 'run-latest.json'),
    JSON.stringify({
      transactions: [{ transactionType: 'CREATE', contractAddress: DD, hash: '0xabc' }],
    }),
  );
  // fake cast: `cast chain-id` → $FAKE_CHAIN_ID, `cast call … owner()` → OWNER, pendingOwner() → zero
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'cast'),
    `#!/bin/sh\ncase "$1" in chain-id) echo "$FAKE_CHAIN_ID";; call) case "$3" in owner*) echo ${OWNER};; *) echo "$FAKE_PENDING";; esac;; esac\n`,
  );
  chmodSync(join(bin, 'cast'), 0o755);
  return { t, bin };
}

const run = (t: string, bin: string, env: Record<string, string>) =>
  spawnSync('node', ['script/fill-deploy-txs.mjs'], {
    cwd: t,
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH ?? ''}`, FAKE_PENDING: `0x${'0'.repeat(40)}`, ...env },
  });

describe('fill-deploy-txs.mjs (RT-P-12)', () => {
  it('a slug that escapes deploy/ is refused and nothing outside deploy/ is written', () => {
    const { t, bin } = tree({ 31337: { slug: 'x/../../../escaped' } });
    const victim = join(dir, 'escaped.json');
    writeFileSync(victim, JSON.stringify({ dataDrop: DD, victim: 'untouched' }));
    mkdirSync(join(t, 'deploy/addresses.x'));
    const r = run(t, bin, { CHAIN: '31337' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/slug must match \[a-z0-9_\]\+/);
    expect(JSON.parse(readFileSync(victim, 'utf8'))).toEqual({ dataDrop: DD, victim: 'untouched' });
  });

  it.each([['Hedera"x'], ['UPPER'], [''], ['a b']])('slug %j is refused', (slug) => {
    const { t, bin } = tree({ 31337: { slug } });
    expect(run(t, bin, { CHAIN: '31337' }).status).not.toBe(0);
  });

  it('CHAIN must be a chains.json key (no prototype keys, no non-decimal ids)', () => {
    const { t, bin } = tree({ 31337: { slug: 'anvil' } });
    for (const chain of ['296', '__proto__', 'constructor', '31337/../x'])
      expect(run(t, bin, { CHAIN: chain }).status, chain).not.toBe(0);
  });

  it('RPC_URL serving another chain: refused before owner()/pendingOwner() are read, file unchanged', () => {
    const { t, bin } = tree({ 296: { slug: 'hedera_testnet' } }, '296');
    const file = join(t, 'deploy/addresses.hedera_testnet.json');
    const before = JSON.stringify({
      dataDrop: DD,
      owner: '0x3333333333333333333333333333333333333333',
    });
    writeFileSync(file, before);
    const r = run(t, bin, { CHAIN: '296', RPC_URL: 'http://rpc.invalid', FAKE_CHAIN_ID: '84532' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/eth_chainId 84532, not CHAIN=296/);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('a non-address owner() answer is refused', () => {
    const { t, bin } = tree({ 296: { slug: 'hedera_testnet' } }, '296');
    writeFileSync(
      join(t, 'deploy/addresses.hedera_testnet.json'),
      JSON.stringify({ dataDrop: DD }),
    );
    const r = run(t, bin, {
      CHAIN: '296',
      RPC_URL: 'http://rpc.invalid',
      FAKE_CHAIN_ID: '296',
      FAKE_PENDING: '0xnot-an-address',
    });
    expect(r.status).not.toBe(0);
  });

  it('the happy path: txs filled, owner/pendingOwner recorded from the matching chain, inside deploy/', () => {
    const { t, bin } = tree({ 296: { slug: 'hedera_testnet' } }, '296');
    const file = join(t, 'deploy/addresses.hedera_testnet.json');
    writeFileSync(file, JSON.stringify({ dataDrop: DD }));
    const r = run(t, bin, { CHAIN: '296', RPC_URL: 'http://rpc.invalid', FAKE_CHAIN_ID: '296' });
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(out.txs).toEqual({ dataDrop: '0xabc', usdc: '' });
    expect(out.owner).toBe(OWNER);
    expect(out.pendingOwner).toBe(`0x${'0'.repeat(40)}`);
    expect(existsSync(join(dir, 'escaped.json'))).toBe(false);
  });
});
