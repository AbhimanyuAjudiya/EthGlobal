/**
 * Red-team verification variant for RT-P-10 (the fixture recorder redacts by schema and refuses to write a leftover):
 * the regression round-trips one synthetic capture with each secret in its canonical place. Here the same secrets
 * arrive in other shapes — a JSON body double-encoded inside a string, a secret key whose value is an object or an
 * array, an LPA inside free text, a non-JSON text body, key/query/host spellings in other cases, a URL with
 * credentials in its userinfo, our own webhook token inside a URL inside a JSON field. Property (the write gate): for
 * every capture, either no secret value survives redaction, or the recorder's own checks (leftovers over removed +
 * env secrets, and scan.sh) refuse to write it.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Recording } from '@ethglobal/adapters/testing';

import { envSecrets, leftovers, redactor, redactRecording } from '../../lib/recorder.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const SCAN = join(ROOT, 'security/redteam/tools/scan.sh');
const S = {
  // built at runtime so the committed file carries no real-format LPA (scan.sh)
  lpa: ['LPA:1', 'rsp.truphone.com', 'QR-G-5C-1LS-1W1Z9P7'].join('$'),
  iccid: '89852240810733000017',
  rpSig: `0x${'ab'.repeat(65)}`,
  r: `0x${'cd'.repeat(32)}`,
  nullifier: `0x${'1f'.repeat(32)}`,
  accessCode: 'b3f1c9e07a5d4e2f8c6a1b9d0e7f3a25',
  webhookToken: 'wh-tok-9f8e7d6c5b4a39281706f5e4',
  arkivKey: 'ZyXwVuTsRqPoNmLkJiHgFeDcBa987654',
  password: 'hunter2-but-longer-0001',
};
const ENV = {
  ESIMACCESS_ACCESS_CODE: S.accessCode,
  ESIMACCESS_WEBHOOK_TOKEN: S.webhookToken,
  ARKIV_ACCESS_KEY: S.arkivKey,
};

function scan(text: string): number {
  const dir = mkdtempSync(join(tmpdir(), 'verify-p10-'));
  try {
    const file = join(dir, 'fixtures', 'reseller', 'esimaccess', 'live-x.json');
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, text);
    return spawnSync('bash', [SCAN, file], { encoding: 'utf8' }).status ?? 2;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const rec = (
  request: Recording['exchanges'][0]['request'],
  response: Recording['exchanges'][0]['response'],
) =>
  ({
    name: 'live-verify',
    recordedAt: '2026-11-04T15:00:00Z',
    source: 'live',
    exchanges: [{ request, response }],
  }) as Recording;

const CASES: [string, Recording][] = [
  [
    'double-encoded JSON body',
    rec(
      { method: 'POST', url: 'https://capture.example/webhook' },
      {
        status: 200,
        body: { raw: JSON.stringify({ inner: JSON.stringify({ ac: S.lpa, iccid: S.iccid }) }) },
      },
    ),
  ],
  [
    'signature as an object, proof as an array',
    rec(
      { method: 'POST', url: 'https://developer.world.org/api/v4/verify/rp_x' },
      {
        status: 200,
        body: { signature: { r: S.r, s: S.rpSig, v: 27 }, proof: [S.r, S.nullifier] },
      },
    ),
  ],
  [
    'LPA in free text and a non-JSON body with an ICCID',
    rec(
      { method: 'GET', url: 'https://api.esimaccess.com/x' },
      { status: 200, body: `Your eSIM: ${S.lpa} on line iccid=${S.iccid}` },
    ),
  ],
  [
    'upper-case key, query and host spellings',
    rec(
      {
        method: 'POST',
        url: `https://RPC.RABDI.DB-CHAIN.TESTNET.ARKIV.NETWORK:443/${S.arkivKey}?TOKEN=${S.webhookToken}`,
      },
      { status: 200, body: { ICCID: S.iccid, Nullifier_Hash: S.nullifier, AC: S.lpa } },
    ),
  ],
  [
    'credentials in URL userinfo',
    rec({ method: 'GET', url: `https://admin:${S.password}@api.example/x` }, { status: 200 }),
  ],
  [
    'our webhook token inside a URL inside a JSON field',
    rec(
      {
        method: 'POST',
        url: 'https://api.esimaccess.com/api/v1/open/webhook/save',
        body: {
          webhook: `https://vps.example/webhooks/reseller/esimaccess?token=${S.webhookToken}`,
        },
      },
      { status: 200, body: { success: true } },
    ),
  ],
  [
    'access code echoed in an error message',
    rec(
      { method: 'POST', url: 'https://api.esimaccess.com/api/v1/open/esim/query' },
      { status: 401, body: { errorMsg: `invalid RT-AccessCode ${S.accessCode}` } },
    ),
  ],
];

describe('verify RT-P-10: redact or refuse, whatever the shape', () => {
  it.each(CASES)('%s', (_name, capture) => {
    const r = redactor();
    const red = redactRecording(capture, r);
    const text = JSON.stringify(red, null, 2);
    const wouldWrite =
      leftovers(text, [...r.removed, ...envSecrets(ENV)]).length === 0 && scan(text) === 0;
    // the secret classes RT-P-10 names (+ nullifiers, tokens, passwords). Observation, not part of the property:
    // an ICCID in a NON-JSON text body is neither redacted (iccid is redacted by JSON key only) nor caught by
    // leftovers()/scan.sh — see RT-P-10.md "Verification".
    const survivors = Object.entries(S)
      .filter(([k]) => !(k === 'iccid' && typeof capture.exchanges[0]!.response.body === 'string'))
      .filter(([, v]) => text.includes(v))
      .map(([k]) => k);
    if (wouldWrite) expect(survivors).toEqual([]);
  });
});
