/**
 * THREAT-MODEL T-86 (repo / fixture / artefact leakage) — regression for RT-P-03, RT-P-07, RT-P-10 and the repo half
 * of RT-P-09 (wave3-web-ops.md OP1, OP6, W7):
 *   - every artefact path the THREAT-MODEL lists is git-ignored, none is tracked, demo fixtures carry no PIN;
 *   - the recorder (scripts/lib/recorder.ts) round-trips synthetic secrets: every known secret field is redacted
 *     by schema, the leftover check and scan.sh both pass on the result and both fire on the raw capture;
 *   - CI scans fixtures in a blocking job and uploads only scanned artefacts; e2e-local scans every log it writes.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  envSecrets,
  fixtureTarget,
  leftovers,
  recordingFetch,
  redactor,
  redactRecording,
} from '../../lib/recorder.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const git = (...args: string[]) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
const SCAN = join(ROOT, 'security/redteam/tools/scan.sh');

/** scan.sh over `text` placed at a fixtures/ path (the profile CI applies to committed fixtures). */
function scan(text: string): number {
  const dir = mkdtempSync(join(tmpdir(), 'rt86-'));
  try {
    const file = join(dir, 'fixtures', 'reseller', 'esimaccess', 'live-x.json');
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, text);
    return spawnSync('bash', [SCAN, file], { encoding: 'utf8' }).status ?? 2;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('T-86: artefacts that hold PINs, LPAs, keys or traces stay out of git (RT-P-03)', () => {
  const MUST_IGNORE = [
    '.e2e/x',
    '.e2e/run-1/cards.json',
    '.agent/journal.jsonl',
    'fixtures/inventory.enc',
    'out/cards-2026-11-05.pdf',
    'out/cards-2026-11-05.manifest.json',
    '.env',
    '.env.local',
    'apps/web/test-results/trace.zip',
    'apps/web/playwright-report/index.html',
    'apps/web/blob-report/report.zip',
    'fixtures/reseller/esimaccess/live-order.raw.json',
    'fixtures/world/live-verify.raw.json',
    'fixtures/arkiv/live-rpc.raw.json',
    'packages/contracts/deploy/addresses.anvil.json',
    'marketing/videos/renders/x.mp4',
  ];

  it.each(MUST_IGNORE)('git check-ignore %s', (p) => {
    expect(git('check-ignore', '-q', p).status).toBe(0);
  });

  it('the redacted recording itself (live-*.json) is NOT ignored: it is what gets committed', () => {
    expect(git('check-ignore', '-q', 'fixtures/world/live-verify.json').status).toBe(1);
  });

  it('no secret-bearing artefact is tracked; fixtures/demo carries serials and MB only', () => {
    const tracked = git(
      'ls-files',
      '.e2e',
      '.agent',
      'out',
      'fixtures/inventory.enc',
      'apps/web/test-results',
      'apps/web/playwright-report',
      ':(glob)fixtures/**/live-*.raw.json',
    ).stdout.trim();
    expect(tracked).toBe('');
    const demo = git('ls-files', 'fixtures/demo').stdout.trim().split('\n').filter(Boolean);
    for (const f of demo) expect(read(f)).not.toMatch(/"pin"\s*:|\b\d{16}\b/);
  });
});

describe('T-86 / OP6: the recorder redacts every known secret by schema (RT-P-10)', () => {
  // synthetic, real-FORMAT values (never real ones): what a Wednesday capture would contain. The LPA is assembled at
  // runtime so this source file itself never carries a real-format activation code (scan.sh would rightly fire).
  const SMDP = ['rsp-eu', 'smdp-synthetic', 'net'].join('.');
  const S = {
    accessCode: 'f3a9c2e17b4d4e0a9c8b7a6d5e4f3a21',
    rtSignature: 'a'.repeat(32) + 'b'.repeat(32),
    lpa: `LPA:1$${SMDP}$7F3A-91C2-44D0-B8E1`,
    qr: 'https://p.qrsim.net/6c1e7b5a-qr.png',
    iccid: '89852240400012345678',
    rpSig: `0x${'5e'.repeat(65)}`,
    nullifier: `0x${'2f'.repeat(32)}`,
    arkivKey: 'AbCdEfGhIjKlMnOpQrStUvWx0123456789',
    webhookToken: 'wh-token-0123456789abcdef0123',
    bearer: 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.c2lnbmF0dXJl',
    paymentSig: 'eyJ4NDAyVmVyc2lvbiI6Mn0Abcdefghijklmnopqrstuvwxyz0123456789',
  };

  async function capture() {
    const fake: typeof fetch = async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      const body = url.includes('esim/query')
        ? {
            success: true,
            obj: { esimList: [{ iccid: S.iccid, ac: S.lpa, qrCodeUrl: S.qr, totalVolume: 1 }] },
          }
        : url.includes('rp-context')
          ? { rp_context: { rp_id: 'rp_abc', nonce: '0x01', signature: S.rpSig } }
          : url.includes('verify')
            ? { success: true, nullifier: S.nullifier, results: [{ nullifier_hash: S.nullifier }] }
            : { jsonrpc: '2.0', id: 1, result: '0x76ed9f' };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json', 'set-cookie': `session=${S.accessCode}` },
      });
    };
    const rec = recordingFetch(fake);
    await rec.fetch('https://api.esimaccess.com/api/v1/open/esim/query', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'RT-AccessCode': S.accessCode,
        'RT-Signature': S.rtSignature,
        'RT-Timestamp': '1762300000000',
      },
      body: JSON.stringify({ iccid: S.iccid }),
    });
    await rec.fetch('https://api.example-vps.dev/world/rp-context', {
      method: 'POST',
      headers: { authorization: S.bearer, 'PAYMENT-SIGNATURE': S.paymentSig },
      body: '{}',
    });
    await rec.fetch('https://developer.world.org/api/v4/verify/rp_abc', {
      method: 'POST',
      body: JSON.stringify({ nullifier_hash: S.nullifier, proof: `0x${'11'.repeat(128)}` }),
    });
    await rec.fetch(`https://rabdi.db-chain.testnet.arkiv.network/${S.arkivKey}`, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    });
    await rec.fetch(
      `https://capture.example-vps.dev/webhooks/reseller/esimaccess?token=${S.webhookToken}`,
    );
    return {
      name: 'live-synthetic',
      recordedAt: '2026-11-04T14:00:00Z',
      source: 'live' as const,
      exchanges: rec.exchanges,
    };
  }

  it('the raw capture holds every secret; scan.sh and the leftover check both fire on it', async () => {
    const raw = JSON.stringify(await capture(), null, 2);
    for (const v of Object.values(S)) expect(raw).toContain(v);
    expect(scan(raw)).toBe(1);
    expect(leftovers(raw, Object.values(S)).length).toBeGreaterThan(0);
  });

  it('redacted: no original value remains, shapes are kept, scan.sh is clean, the recorder would write it', async () => {
    const raw = await capture();
    const r = redactor();
    const red = redactRecording(raw, r);
    const text = JSON.stringify(red, null, 2);
    for (const [name, v] of Object.entries(S)) expect(text, name).not.toContain(v);
    expect(leftovers(text, [...r.removed, ...Object.values(S)])).toEqual([]);
    expect(scan(text)).toBe(0);

    // placeholders keep what a schema/fixture test checks
    const esim = red.exchanges[0]!.response.body as {
      obj: { esimList: { iccid: string; ac: string; qrCodeUrl: string }[] };
    };
    const line = esim.obj.esimList[0]!;
    expect(line.ac).toMatch(/^LPA:1\$smdp\.example\$REDACTED-\d{4}$/);
    expect(line.iccid).toMatch(/^89\d{17,20}$/);
    expect(line.qrCodeUrl).toMatch(/^https:\/\/redacted\.example\//);
    const rp = red.exchanges[1]!.response.body as {
      rp_context: { signature: string; rp_id: string };
    };
    expect(rp.rp_context.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(rp.rp_context.rp_id).toBe('rp_abc'); // public ids stay
    expect(red.exchanges[0]!.request.headers?.['rt-timestamp']).toBe('1762300000000');
    expect(red.exchanges[3]!.request.url).not.toContain(S.arkivKey);
    expect(red.exchanges[3]!.request.url).toMatch(
      /^https:\/\/rabdi\.db-chain\.testnet\.arkiv\.network\//,
    );
    expect(new URL(red.exchanges[4]!.request.url).searchParams.get('token')).toMatch(/^<redacted-/);
  });

  it('environment credentials count as secrets; a recording that still has one is refused', () => {
    const env = {
      ESIMACCESS_ACCESS_CODE: S.accessCode,
      ARKIV_ACCESS_KEY: S.arkivKey,
      MODE: 'live',
    };
    expect(envSecrets(env).sort()).toEqual([S.accessCode, S.arkivKey].sort());
    expect(leftovers(`{"note":"${S.arkivKey}"}`, envSecrets(env))).toHaveLength(1);
    // the refusal message never repeats the value
    expect(leftovers(`{"note":"${S.arkivKey}"}`, envSecrets(env))[0]).not.toContain(S.arkivKey);
  });

  it('fixture targets stay inside fixtures/ and are named live-*.json (raw: live-*.raw.json, git-ignored)', () => {
    const fx = join(ROOT, 'fixtures');
    expect(fixtureTarget(fx, 'reseller/esimaccess', 'plans')).toBe(
      join(fx, 'reseller/esimaccess/live-plans.json'),
    );
    expect(fixtureTarget(fx, 'world', 'verify', true)).toBe(join(fx, 'world/live-verify.raw.json'));
    for (const [vendor, name] of [
      ['../escape', 'x'],
      ['world', '../../x'],
      ['/etc', 'x'],
      ['a/b/c', 'x'],
      ['world', 'X'],
    ] as const)
      expect(() => fixtureTarget(fx, vendor, name)).toThrow();
  });

  it('record-fixture.ts refuses an unknown flow with a usage error and writes nothing', () => {
    const tsx = join(ROOT, 'scripts/node_modules/.bin/tsx');
    const r = spawnSync(tsx, [join(ROOT, 'scripts/record-fixture.ts'), 'no-such-flow'], {
      cwd: join(ROOT, 'scripts'),
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/flow must be one of: esimaccess-plans/);
  }, 30_000);
});

describe('T-86: CI and e2e only ship scanned artefacts (RT-P-07, RT-P-10)', () => {
  const ci = read('.github/workflows/ci.yml');
  const job = (name: string) => {
    const start = ci.indexOf(`\n  ${name}:\n`);
    const rest = ci.slice(start + 1);
    const next = rest.slice(1).search(/\n {2}[a-z0-9-]+:\n/);
    return next < 0 ? rest : rest.slice(0, next + 1);
  };

  it('the blocking checks job and a needs-free fixture-scan job scan fixtures/ (not continue-on-error)', () => {
    for (const name of ['checks', 'fixture-scan']) {
      const j = job(name);
      expect(j, name).toMatch(/check-forbidden\.sh[^\n]*fixtures/);
      expect(j, name).not.toContain('continue-on-error');
    }
    expect(job('fixture-scan')).not.toContain('needs:');
    const forbidden = read('scripts/check-forbidden.sh');
    expect(forbidden).toContain('security/redteam/tools/scan.sh');
  });

  it('e2e logs upload only after their scan succeeded; Playwright output is scanned before upload', () => {
    const e2e = job('e2e-local');
    expect(e2e).toMatch(/id: logscan[\s\S]*scan\.sh/);
    const upload = /name: Upload logs[\s\S]*?if-no-files-found/.exec(e2e)?.[0] ?? '';
    expect(upload).toContain("steps.logscan.outcome == 'success'");
    expect(upload).not.toMatch(/if: always\(\)/);
    expect(upload).toContain('.e2e/**/*.log');
    const pw = job('playwright');
    expect(pw).toMatch(/id: pwscan[\s\S]*scan\.sh/);
    expect(/name: Upload the Playwright[\s\S]*?if-no-files-found/.exec(pw)?.[0]).toContain(
      "steps.pwscan.outcome == 'success'",
    );
  });

  it('the fault run must fail at I-10 with the planted marker (not for any reason)', () => {
    const e2e = job('e2e-local');
    expect(e2e).not.toMatch(/! E2E_FAULT=1 bash/);
    expect(e2e).toContain("grep -q 'FAIL I-10 agent: .*\\[E2E_FAULT planted\\]'");
    expect(read('scripts/e2e-agent.ts')).toContain("const FAULT_MARKER = '[E2E_FAULT planted]'");
  });

  it('e2e-local scans every log and dump of its run dir; dev-chain never prints the mnemonic', () => {
    const sh = read('scripts/e2e-local.sh');
    expect(sh).toMatch(
      /find "\$OUT" -type f \\\( -name '\*\.log' -o -name 'ledger-dump\.json' \\\)/,
    );
    expect(sh).not.toContain('scan.sh" "$OUT/api.log" "$OUT/agent.log"');
    const chain = read('scripts/dev-chain.sh');
    expect(chain).not.toMatch(/echo[^\n]*\$MNEMONIC\b/);
    expect(chain).toContain('mnemonic: $MNEMONIC_LABEL');
    // and the reaper message never prints a process's arguments (Anvil's carry --mnemonic)
    expect(sh).not.toMatch(/\$\{args:0:/);
  });

  it('the ops scripts the plans name exist and parse (RT-P-09)', () => {
    for (const sh of [
      'check-forbidden.sh',
      'check-design-bans.sh',
      'refresh-lockfile.sh',
      'e2e-local.sh',
    ])
      execFileSync('bash', ['-n', join(ROOT, 'scripts', sh)]);
    for (const ts of ['dump-ledger.ts', 'redteam/run.ts', 'record-fixture.ts'])
      expect(read(`scripts/${ts}`).length).toBeGreaterThan(200);
    expect(read('security/redteam/run-wave.sh')).toContain('scripts/check-design-bans.sh');
  });
});
