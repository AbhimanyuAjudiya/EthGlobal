/** T-50, AP15 (brief: logs.test.ts): a busy session's pino output holds no secret, proof, payment or PIN. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { anvilKeys } from '@ethglobal/adapters/testing';

import { sponsorAuthorization } from '../support/client.js';
import {
  buyGift,
  claimGiftBySignature,
  harness,
  iccidOf,
  provisioned,
  SPONSOR_KEY,
  topUp,
  webhook,
} from '../support/harness.js';

describe('T-50 log redaction', () => {
  it('logs carry paths and events only', async () => {
    const h = await harness();
    const { key, proof, body } = await provisioned(h, 'logs');
    const { pay } = await topUp(h, key);
    await webhook(h, iccidOf(h, key), 12).send();
    const gift = await buyGift(h);
    await claimGiftBySignature(h, gift.giftId, anvilKeys[1]);
    const rp = (await (
      await h.json('/world/rp-context', { audience: 'recharge', path: '/claim' })
    ).json()) as { signature: string };
    const auth = await sponsorAuthorization(
      SPONSOR_KEY,
      h.deps.chainId,
      h.campaignId,
      h.clock.now(),
    );
    const view = (await (
      await h.get(`/sponsor/${h.campaignId}`, { authorization: auth })
    ).json()) as { auditKey: string };
    await h.request('/webhooks/reseller/mock?token=abcdefghijklmnop0123', {
      method: 'POST',
      body: '{}',
    });
    const logs = h.lines.join('');
    const v4 = proof.responses[0] as { nullifier: string };
    const forbidden = [
      Object.values(pay)[0] ?? 'x',
      auth.split(' ')[1] ?? 'x',
      'token=',
      rp.signature,
      v4.nullifier,
      `0x${BigInt(v4.nullifier).toString(16).padStart(64, '0')}`,
      'LPA:',
      gift.pin,
      view.auditKey,
      body.sealedLpa?.ct ?? 'x',
      iccidOf(h, key),
      h.deps.env.OCTROI_SECRET.slice(2),
    ];
    for (const value of forbidden) expect(logs).not.toContain(value);
    expect(logs).toMatch(/"event":"request".*"path":"\/webhooks\/reseller\/mock"/);
    const dir = mkdtempSync(join(tmpdir(), 'recharge-logs-'));
    writeFileSync(join(dir, 'api.log'), logs);
    const scan = spawnSync(
      'bash',
      [
        new URL('../../../../security/redteam/tools/scan.sh', import.meta.url).pathname,
        join(dir, 'api.log'),
      ],
      { encoding: 'utf8' },
    );
    expect(scan.status).toBe(0);
  });
});
