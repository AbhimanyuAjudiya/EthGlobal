/**
 * Red-team verification variant for RT-A-14 (dev-chain.sh never writes the mnemonic into .e2e/chain.log): the
 * regression scans the log of a default run. Here dev-chain.sh runs with a CUSTOM ANVIL_MNEMONIC (the .env case) and
 * with an INVALID one (Anvil's own error path), capturing stdout + stderr as e2e-local.sh does. Property: the phrase
 * never appears (at most one word of an invalid phrase, which is Anvil's parse error), and scan.sh is clean.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const ADDR = join(ROOT, 'packages/contracts/deploy/addresses.anvil.json');
const SCAN = join(ROOT, 'security/redteam/tools/scan.sh');
const dir = mkdtempSync(join(tmpdir(), 'verify-a14-'));
const backup = existsSync(ADDR) ? readFileSync(ADDR, 'utf8') : undefined;
afterAll(() => {
  if (backup !== undefined) writeFileSync(ADDR, backup);
  rmSync(dir, { recursive: true, force: true });
});

function devChain(port: number, mnemonic: string, ms: number): Promise<string> {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn('bash', [join(ROOT, 'scripts/dev-chain.sh')], {
      env: { ...process.env, ANVIL_PORT: String(port), ANVIL_MNEMONIC: mnemonic },
      detached: true,
    });
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    const stop = () => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        /* gone */
      }
    };
    const t = setTimeout(stop, ms);
    const poll = setInterval(() => {
      if (/deploy script finished|Error|did not come up/.test(out)) stop();
    }, 200);
    child.on('exit', () => {
      clearTimeout(t);
      clearInterval(poll);
      setTimeout(() => resolve(out), 300);
    });
  });
}

const scanClean = (text: string) => {
  const f = join(dir, `chain-${Math.random().toString(36).slice(2)}.log`);
  writeFileSync(f, text);
  return spawnSync('bash', [SCAN, f], { encoding: 'utf8' }).status === 0;
};

describe.skipIf(spawnSync('anvil', ['--version']).status !== 0)(
  'verify RT-A-14: no mnemonic in the chain log',
  () => {
    it('a custom ANVIL_MNEMONIC is never printed', async () => {
      const phrase =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      const log = await devChain(18_911, phrase, 90_000);
      expect(log).toContain('ANVIL_MNEMONIC (redacted)');
      expect(log).not.toContain('abandon abandon');
      expect(scanClean(log)).toBe(true);
    }, 120_000);

    it('an invalid ANVIL_MNEMONIC: Anvil may name one bad word, never the phrase', async () => {
      const phrase =
        'zebra quantum lattice orbit nectar velvet harbor tundra pixel saffron glacier ember';
      const log = await devChain(18_913, phrase, 30_000);
      expect(log).not.toContain('quantum lattice');
      const words = phrase.split(' ').filter((w) => log.includes(w));
      expect(words.length).toBeLessThanOrEqual(1);
      expect(scanClean(log)).toBe(true);
    }, 60_000);
  },
);
