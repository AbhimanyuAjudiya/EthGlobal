import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * T-63: no private key and no demo-wallet secret in what the browser downloads. Runs over `.next/static` after a
 * production build (skipped when there is none). The demo wallet signs server-side (app/api/demo-wallet), from a
 * mnemonic in the server's environment, so even a MODE=local bundle carries none of these.
 */
const STATIC = path.join(import.meta.dirname, '..', process.env.NEXT_DIST_DIR ?? '.next', 'static');
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

/**
 * RT-W-12 / RT-W-11 (T-63, T-81): a NEXT_PUBLIC_MODE=live build carries no local-only CODE either — not just no
 * key. The demo-wallet transport, the simulated World ID call and the e2e hook are guarded by a literal
 * `process.env.NEXT_PUBLIC_MODE === 'local'` and live in lib/local/*, so the minifier drops them; idkit-core's RP
 * signer is aliased to a throwing stand-in for the browser (next.config.ts). Point LIVE_BUNDLE_DIR at a live build's
 * dist dir (`NEXT_DIST_DIR=.next-live NEXT_PUBLIC_MODE=live next build`, or run.sh's tmp/rt-web-live/.next).
 */
const LIVE = process.env.LIVE_BUNDLE_DIR
  ? path.join(path.resolve(process.env.LIVE_BUNDLE_DIR), 'static')
  : '';

describe.skipIf(!LIVE || !existsSync(LIVE))('live client bundle (LIVE_BUNDLE_DIR)', () => {
  const hits = (needles: readonly string[]) =>
    files(LIVE)
      .filter((f) => f.endsWith('.js'))
      .flatMap((f) => {
        const text = readFileSync(f, 'utf8');
        return needles.filter((n) => text.includes(n)).map((n) => `${path.basename(f)}: ${n}`);
      });

  it('compiles out the demo wallet, the World ID simulator call and the e2e hook', () => {
    expect(hits(['__local/world-proof', '/api/demo-wallet', '__RECHARGE_TEST__'])).toEqual([]);
  });

  // AUD-09: the demo-wallet banner lives in lib/local/demo-wallet-panel.tsx behind a lazy import; its body was already
  // dead code in live, but the exported name used to survive in a shared chunk
  it('carries no demo-wallet banner: neither its name nor its markup', () => {
    expect(
      hits(['DemoWalletPanel', 'demo-wallet__addr', '"demo-wallet"', 'demo-wallet-panel']),
    ).toEqual([]);
  });

  it('carries no rp_context signer code', () => {
    expect(hits(['signingKeyHex', 'signRequest expects'])).toEqual([]);
  });
});
