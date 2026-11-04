/**
 * scripts/record-fixture.ts — the Wednesday recorder (ops-demo §1, RT-P-10, THREAT-MODEL T-86, OP6). Runs one named
 * flow against the LIVE vendor with the real adapter, captures every request/response through a recording fetch (the
 * `fetch` the adapters accept), redacts every known secret by schema (scripts/lib/recorder.ts), and writes
 * `fixtures/<vendor>/live-<name>.json` in the `Recording` format `fixtureFetch` replays. It REFUSES to write when a
 * redacted value, an environment credential or a real-format LPA would remain, or when security/redteam/tools/scan.sh
 * finds a forbidden pattern in the result. The unredacted capture is never written unless `--raw` asks for it, and
 * then only as `live-<name>.raw.json` (git-ignored, RT-P-03; 0600; delete it after the review).
 *
 * Credentials come from the environment, loaded from the git-ignored `.env` — never typed on a command line:
 *
 *   set -a; source .env; set +a
 *   pnpm --filter @ethglobal/scripts exec tsx record-fixture.ts esimaccess-plans
 *   pnpm --filter @ethglobal/scripts exec tsx record-fixture.ts esimaccess-usage --iccid-env RECORD_ICCID
 *   pnpm --filter @ethglobal/scripts exec tsx record-fixture.ts x402org-supported
 *   pnpm --filter @ethglobal/scripts exec tsx record-fixture.ts hcs-mirror-messages
 *   pnpm --filter @ethglobal/scripts exec tsx record-fixture.ts arkiv-rpc
 *   pnpm --filter @ethglobal/scripts exec tsx record-fixture.ts http --vendor world --name verify \
 *     --method POST --url "$WORLD_VERIFY_BASE_URL/api/v4/verify/$WORLD_RP_ID" --body-file /secure/proof.json
 *   … --dry-run   # print the redacted recording instead of writing it
 *
 * Exit 0 = written (or printed), 1 = refused (nothing written), 2 = usage.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { parseArgs } from 'node:util';

import { EsimAccessReseller, ESIMACCESS_BASE_URL } from '@ethglobal/adapters/live';
import type { Recording } from '@ethglobal/adapters/testing';

import { cliArgs, ROOT } from './lib/harness.js';
import {
  envSecrets,
  fixtureTarget,
  leftovers,
  recordingFetch,
  redactor,
  redactRecording,
} from './lib/recorder.js';

const FIXTURES = join(ROOT, 'fixtures');
const SCAN = join(ROOT, 'security/redteam/tools/scan.sh');

const { values: flags, positionals } = parseArgs({
  args: cliArgs(),
  allowPositionals: true,
  options: {
    vendor: { type: 'string' },
    name: { type: 'string' },
    method: { type: 'string', default: 'GET' },
    url: { type: 'string' },
    'body-file': { type: 'string' },
    'iccid-env': { type: 'string' },
    raw: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
});

const need = (name: string): string => {
  const v = process.env[name];
  if (v === undefined || v === '')
    throw new Usage(`${name} is not set (load .env with: set -a; source .env; set +a)`);
  return v;
};

class Usage extends Error {}
/** Rethrows a bad argument as a usage error (exit 2). */
function usage<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw new Usage(error instanceof Error ? error.message : String(error));
  }
}

interface Flow {
  /** fixtures/<vendor>/ */
  vendor: string;
  name: string;
  run(f: typeof fetch): Promise<unknown>;
}

const esim = (f: typeof fetch) =>
  new EsimAccessReseller({
    accessCode: need('ESIMACCESS_ACCESS_CODE'),
    webhookToken: need('ESIMACCESS_WEBHOOK_TOKEN'),
    baseUrl: process.env.ESIMACCESS_BASE_URL ?? ESIMACCESS_BASE_URL,
    fetch: f,
    now: Date.now,
  });
const get = async (f: typeof fetch, url: string, init?: RequestInit) => (await f(url, init)).status;

/** The named flows: read-only against the vendor unless the flow's name says otherwise. */
const FLOWS: Record<string, () => Flow> = {
  'esimaccess-plans': () => ({
    vendor: 'reseller/esimaccess',
    name: 'plans',
    run: (f) => esim(f).plans('IN'),
  }),
  'esimaccess-usage': () => ({
    vendor: 'reseller/esimaccess',
    name: 'query',
    // the ICCID comes from an env var named on the command line, so the line id never sits in shell history
    run: (f) => esim(f).usage(need(flags['iccid-env'] ?? 'RECORD_ICCID')),
  }),
  'x402org-supported': () => ({
    vendor: 'facilitator/x402org',
    name: 'supported',
    run: (f) =>
      get(
        f,
        `${(process.env.X402_FACILITATOR_URL_EVM ?? 'https://x402.org/facilitator').replace(/\/$/, '')}/supported`,
      ),
  }),
  'hcs-mirror-messages': () => ({
    vendor: 'hcs',
    name: 'mirror-messages',
    run: (f) =>
      get(
        f,
        `${(process.env.HEDERA_MIRROR_URL ?? 'https://testnet.mirrornode.hedera.com').replace(/\/$/, '')}` +
          `/api/v1/topics/${need('HCS_TOPIC_ID')}/messages?limit=5&order=desc`,
      ),
  }),
  'arkiv-rpc': () => ({
    vendor: 'arkiv',
    name: 'rpc',
    run: async (f) => {
      const url = need('ARKIV_RPC_URL');
      for (const [id, method] of [
        [1, 'eth_chainId'],
        [2, 'eth_blockNumber'],
      ] as const) {
        await get(f, url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id, method, params: [] }),
        });
      }
    },
  }),
  http: () => {
    if (!flags.vendor || !flags.name || !flags.url)
      throw new Usage('http needs --vendor, --name and --url');
    const body =
      flags['body-file'] === undefined ? undefined : readFileSync(flags['body-file'], 'utf8');
    return {
      vendor: flags.vendor,
      name: flags.name,
      run: (f) =>
        get(f, flags.url!, {
          method: flags.method.toUpperCase(),
          ...(body === undefined ? {} : { body, headers: { 'content-type': 'application/json' } }),
        }),
    };
  },
};

/** scan.sh over `text` placed under a fixtures/ path (the profile CI applies to committed fixtures). */
function scanClean(text: string, rel: string): { ok: boolean; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'recharge-record-'));
  try {
    const file = join(dir, 'fixtures', rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, { mode: 0o600 });
    const r = spawnSync('bash', [SCAN, file], { encoding: 'utf8' });
    return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const flowName = positionals[0];
  const make = flowName === undefined ? undefined : FLOWS[flowName];
  if (make === undefined) throw new Usage(`flow must be one of: ${Object.keys(FLOWS).join(', ')}`);
  const flow = make();
  const target = usage(() => fixtureTarget(FIXTURES, flow.vendor, flow.name));

  const rec = recordingFetch(fetch);
  let outcome = 'ok';
  try {
    await flow.run(rec.fetch);
  } catch (error) {
    // a vendor error is a fixture too (errors.json): keep the exchanges, say what happened
    outcome = `flow threw ${error instanceof Error ? error.name : 'error'}`;
  }
  if (rec.exchanges.length === 0) {
    console.error(`record-fixture: ${flowName} made no HTTP call (${outcome})`);
    return 1;
  }
  const raw: Recording = {
    name: `live-${flow.name}`,
    recordedAt: new Date().toISOString(),
    source: 'live',
    exchanges: rec.exchanges,
  };
  const r = redactor();
  const redacted = redactRecording(raw, r);
  const text = `${JSON.stringify(redacted, null, 2)}\n`;

  const left = leftovers(text, [...r.removed, ...envSecrets(process.env)]);
  const rel = relative(FIXTURES, target);
  const scan = scanClean(text, rel);
  if (left.length > 0 || !scan.ok) {
    console.error(
      `record-fixture: REFUSED to write ${relative(ROOT, target)} — a secret would remain:`,
    );
    for (const l of left) console.error(`  - ${l}`);
    if (!scan.ok) console.error(scan.out.replace(/^/gm, '  scan: ').trimEnd());
    console.error(
      'record-fixture: extend SECRET_KEYS/SECRET_HEADERS in scripts/lib/recorder.ts and record again.',
    );
    return 1;
  }
  if (flags['dry-run']) {
    process.stdout.write(text);
    return 0;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  if (flags.raw) {
    const rawFile = fixtureTarget(FIXTURES, flow.vendor, flow.name, true);
    writeFileSync(rawFile, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
    chmodSync(rawFile, 0o600);
    console.log(
      `record-fixture: unredacted capture ${relative(ROOT, rawFile)} (git-ignored, 0600): delete it after review`,
    );
  }
  console.log(
    `record-fixture: ${relative(ROOT, target)} — ${redacted.exchanges.length} exchange(s), ${r.removed.size} value(s) redacted, ` +
      `scan clean (${outcome})`,
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`record-fixture: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(error instanceof Usage ? 2 : 1);
  },
);
