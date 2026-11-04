import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * T-63: no private key and no demo-wallet secret in what the browser downloads. Runs over `.next/static` after a
 * production build (skipped when there is none). The demo wallet signs server-side (app/api/demo-wallet), from a
 * mnemonic in the server's environment, so even a MODE=local bundle carries none of these.
 */
const STATIC = path.join(import.meta.dirname, '..', '.next', 'static');
const FORBIDDEN = [
  'ac0974bec39a17e36ba4a6b4d238ff944bacb478', // Anvil #0
  '8b3a350cf5c34c9194ca85829a2df0ec3153be03', // Anvil #5 (the demo human)
  'anvilKeys[5]',
  'anvilKeys',
  'test test test test test test test test test test test junk',
  'DEMO_WALLET_MNEMONIC',
  'PRINT_TOKEN',
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

describe.skipIf(!existsSync(STATIC))('production bundle (.next/static)', () => {
  it('contains no Anvil key, no mnemonic and no server secret name', () => {
    const offenders: string[] = [];
    for (const file of files(STATIC)) {
      const text = readFileSync(file, 'latin1');
      for (const needle of FORBIDDEN)
        if (text.includes(needle)) offenders.push(`${path.basename(file)}: ${needle}`);
    }
    expect(offenders).toEqual([]);
  });
});
