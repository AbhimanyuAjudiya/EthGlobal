/**
 * Red-team verification variant for RT-P-12 (`pnpm deploy:txs` writes only inside deploy/, records owner only from a
 * matching chain): the regression escapes with `..` in the slug. Here the slug is clean but the FILE SYSTEM escapes —
 * `deploy/addresses.<slug>.json` is a symlink to a file outside deploy/ — and CHAIN / eth_chainId arrive in other
 * spellings (leading zero, sign, whitespace, hex). Properties: nothing outside deploy/ is written; a CHAIN that is not
 * literally a chains.json key is refused; a hex or padded eth_chainId never matches by accident.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
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

function tree(chains: unknown, chainId: string) {
  dir = mkdtempSync(join(tmpdir(), 'verify-p12-'));
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
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'cast'),
    `#!/bin/sh\ncase "$1" in chain-id) printf '%s\\n' "$FAKE_CHAIN_ID";; call) case "$3" in owner*) echo ${OWNER};; *) echo 0x${'0'.repeat(40)};; esac;; esac\n`,
  );
  chmodSync(join(bin, 'cast'), 0o755);
  return { t, bin };
}

const run = (t: string, bin: string, env: Record<string, string>) =>
  spawnSync('node', ['script/fill-deploy-txs.mjs'], {
    cwd: t,
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH ?? ''}`, ...env },
  });

describe('verify RT-P-12: deploy:txs under file-system and spelling tricks', () => {
  // RT-FINDING RT-P-12: the "directly in deploy/" check is on the path string; writeFileSync follows the symlink.
  it('deploy/addresses.<slug>.json symlinked outside deploy/ ⇒ refused or the outside file untouched_RTFINDING', () => {
    const { t, bin } = tree({ 31337: { slug: 'anvil' } }, '31337');
    const outside = join(dir, 'outside.json');
    const original = JSON.stringify({ dataDrop: DD, victim: 'untouched' });
    writeFileSync(outside, original);
    symlinkSync(outside, join(t, 'deploy/addresses.anvil.json'));
    run(t, bin, { CHAIN: '31337' });
    expect(readFileSync(outside, 'utf8')).toBe(original);
  });

  it.each(['031337', '+31337', ' 31337', '31337 ', '31337.0', '0x7a69', '3.1337e4'])(
    'CHAIN=%j ⇒ refused',
    (chain) => {
      const { t, bin } = tree({ 31337: { slug: 'anvil' } }, '31337');
      writeFileSync(join(t, 'deploy/addresses.anvil.json'), JSON.stringify({ dataDrop: DD }));
      expect(run(t, bin, { CHAIN: chain }).status).not.toBe(0);
    },
  );

  it.each(['0x128', ' 296x', '2960', '29', '296\n84532'])(
    'eth_chainId %j for CHAIN=296 ⇒ refused, file unchanged',
    (answer) => {
      const { t, bin } = tree({ 296: { slug: 'hedera_testnet' } }, '296');
      const file = join(t, 'deploy/addresses.hedera_testnet.json');
      const before = JSON.stringify({
        dataDrop: DD,
        owner: '0x3333333333333333333333333333333333333333',
      });
      writeFileSync(file, before);
      const r = run(t, bin, { CHAIN: '296', RPC_URL: 'http://rpc.invalid', FAKE_CHAIN_ID: answer });
      expect(r.status).not.toBe(0);
      expect(readFileSync(file, 'utf8')).toBe(before);
    },
  );
});
