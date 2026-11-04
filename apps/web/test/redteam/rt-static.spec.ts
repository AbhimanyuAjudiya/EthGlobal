/**
 * Static red-team checks over apps/web source and the built bundle (no browser): W1.3 (no HTML sinks), W10 (no
 * secret in the client bundle, no published source maps, client env reads are NEXT_PUBLIC_* from the documented
 * list), T-64 (the print route is linked from nowhere) and copy hygiene (no internal dev note shipped as UI copy).
 * The live-build (`NEXT_PUBLIC_MODE=live`) grep runs in security/redteam/wave3-web/run.sh, which builds it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import en from '../../i18n/en.json' with { type: 'json' };

const WEB = path.join(import.meta.dirname, '../..');
const ROOT = path.join(WEB, '../..');
const STATIC = path.join(WEB, '.next/static');

function walk(dir: string, keep: (f: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
}
const src = (rel: string) => walk(path.join(WEB, rel), (f) => /\.(tsx?|mjs|js)$/.test(f));
const productSources = () => [
  ...src('app'),
  ...src('components'),
  ...src('lib'),
  ...src('i18n'),
  path.join(WEB, 'proxy.ts'),
];

test.describe('W1.3 no HTML-parsing sinks in the product', () => {
  // Property: no dangerouslySetInnerHTML / innerHTML / outerHTML / insertAdjacentHTML / document.write / eval /
  // new Function / srcdoc in apps/web or packages/ui components.
  test('no HTML or code sinks', () => {
    const files = [
      ...productSources(),
      ...walk(
        path.join(ROOT, 'packages/ui/components'),
        (f) => /\.tsx?$/.test(f) && !f.includes('.test.'),
      ),
    ];
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const re of [
        /dangerouslySetInnerHTML/,
        /\.innerHTML\s*=/,
        /outerHTML/,
        /insertAdjacentHTML/,
        /document\.write/,
        /\beval\(/,
        /new Function\(/,
        /srcdoc/i,
      ])
        if (re.test(text)) hits.push(`${path.relative(ROOT, f)}: ${re.source}`);
    }
    expect(hits).toEqual([]);
  });
});

test.describe('W10 client bundle (local build on disk)', () => {
  const SECRETS = [
    'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Anvil #0
    '8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba', // Anvil #5
    '5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', // Anvil #3
    'test test test test test test test test test test test junk',
    'DEMO_WALLET_MNEMONIC',
    'PRINT_TOKEN',
    'local-e2e-print-token-0001',
    'RP_SIGNING_KEY',
    'OCTROI_SECRET',
    'ESIMACCESS',
    'sk-ant-',
    'mnemonicToAccount',
  ];
  // Property: no private key, mnemonic, server-only variable name or its value is inlined into .next/static.
  test('no secret, mnemonic or server-only name in .next/static', () => {
    test.skip(!existsSync(STATIC), 'no build on disk (run next build first)');
    const hits: string[] = [];
    for (const f of walk(STATIC, (x) => /\.(js|css|html|json|txt)$/.test(x))) {
      const text = readFileSync(f, 'utf8');
      for (const s of SECRETS)
        if (text.includes(s)) hits.push(`${path.relative(WEB, f)}: ${s.slice(0, 18)}`);
    }
    expect(hits).toEqual([]);
  });

  // Property (W2.2, T-81): the browser never carries rp_context signing code — idkit-core's signRequest
  // (signingKeyHex) is not in any client chunk. FINDING RT-W-11: the root '@worldcoin/idkit-core' entry
  // re-exports ./signing and has no sideEffects flag, so the dynamic import ships the signer.
  // RT-FINDING
  test('no rp_context signer code (signRequest / signingKeyHex) in client chunks_RTFINDING', () => {
    test.skip(!existsSync(STATIC), 'no build on disk');
    const hits = walk(STATIC, (x) => x.endsWith('.js'))
      .filter((f) => /signingKeyHex|signRequest expects/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(WEB, f));
    expect(hits).toEqual([]);
  });

  // Property: production client chunks publish no source maps (nothing to leak through them).
  test('no *.map files under .next/static', () => {
    test.skip(!existsSync(STATIC), 'no build on disk');
    expect(walk(STATIC, (x) => x.endsWith('.map')).map((f) => path.relative(WEB, f))).toEqual([]);
  });

  // Property (INTERFACES §11): client code reads only the documented NEXT_PUBLIC_* names.
  test('client env reads are NEXT_PUBLIC_* from the documented list', () => {
    const allowed = new Set([
      'NEXT_PUBLIC_MODE',
      'NEXT_PUBLIC_API_URL',
      'NEXT_PUBLIC_ANVIL_RPC_URL',
      'NEXT_PUBLIC_WORLD_APP_ID',
      'NEXT_PUBLIC_WORLD_ACTION',
      'NEXT_PUBLIC_WORLD_ENVIRONMENT',
      'NEXT_PUBLIC_EXPLORER_EVM',
      'NEXT_PUBLIC_EXPLORER_HEDERA',
      'NEXT_PUBLIC_ARKIV_EXPLORER',
      'NEXT_PUBLIC_DATADROP_ADDRESS',
      'NEXT_PUBLIC_CHAIN_ID',
      'NEXT_PUBLIC_ATTACH_MEDIAN_S',
      'NEXT_PUBLIC_PUBLIC_ORIGIN',
      'NODE_ENV',
    ]);
    const bad: string[] = [];
    for (const f of productSources()) {
      const text = readFileSync(f, 'utf8');
      const client =
        /^['"]use client['"]/m.test(text) ||
        f.includes(`${path.sep}lib${path.sep}`) ||
        f.includes(`${path.sep}components${path.sep}`);
      if (!client) continue;
      for (const m of text.matchAll(/process\.env\.([A-Z0-9_]*[A-Z0-9])\b/g))
        if (!allowed.has(m[1] ?? '')) bad.push(`${path.relative(WEB, f)}: ${m[1]}`);
    }
    expect(bad).toEqual([]);
  });
});

test.describe('T-64 the print route is linked from nowhere', () => {
  // Property: no page or component links to /print/cards; it is absent from the manifest.
  test('no /print/cards link in app, components, manifest', () => {
    const hits = productSources()
      .filter(
        (f) => !f.includes(`${path.sep}app${path.sep}print${path.sep}`) && !f.endsWith('proxy.ts'),
      )
      .filter((f) => readFileSync(f, 'utf8').includes('/print/cards'))
      .map((f) => path.relative(WEB, f));
    expect(hits).toEqual([]);
  });
});

test.describe('copy hygiene (design-foundations §7, design-references §6)', () => {
  // Property: no internal build note reaches a traveller ("from memory", "checked … on Wednesday", "Local mode"
  // outside the local-only keys). FINDING RT-W-09 (install.screenshotNote).
  // RT-FINDING
  test('no internal dev note in shipped UI strings_RTFINDING', () => {
    const LOCAL_ONLY = new Set([
      'verify.simulated',
      'verify.simulatedNote',
      'demo.note',
      'demo.banner',
    ]);
    const notes = Object.entries(en as Record<string, string>)
      .filter(([k]) => !LOCAL_ONLY.has(k))
      .filter(([, v]) => /from memory|on Wednesday|\[screenshot|TODO|TBD|lorem/i.test(v))
      .map(([k, v]) => `${k}: ${v}`);
    expect(notes).toEqual([]);
  });

  // Property: hint copy matches the physical card (design-references §3: the PIN is on the FRONT, under the latex).
  // RT-FINDING
  test('PIN hint does not send people to the back of the card_RTFINDING', () => {
    expect((en as Record<string, string>)['card.pinHint']).not.toMatch(/back of the card/i);
  });

  // Property: no hard-coded English sentence in a component that renders on a translated screen.
  // RT-FINDING
  test('no hard-coded English copy in consumer components_RTFINDING', () => {
    const hits: string[] = [];
    for (const f of [
      'components/PlanView.tsx',
      'components/ScratchRedeem.tsx',
      'components/InstallSteps.tsx',
      'components/PaySheet.tsx',
    ]) {
      const text = readFileSync(path.join(WEB, f), 'utf8');
      for (const re of [
        /lead="[A-Z][a-z]+ [a-z]+"/,
        /ended="[A-Z][a-z]+"/,
        /`Claim by \$\{/,
        /validity: 'Mumbai · 7 days'/,
      ])
        if (re.test(text)) hits.push(`${f}: ${re.source}`);
    }
    expect(hits).toEqual([]);
  });
});
