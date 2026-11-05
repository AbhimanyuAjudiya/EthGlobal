/** AP4 — LPA single delivery and public-ledger content (T-31, T-37, T-44, N7). */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { anvilKeys } from '@ethglobal/adapters/testing';
import { lpaAad, openLpa, type SealedBox } from '@ethglobal/crypto';
import { HCS_MAX_BYTES } from '@ethglobal/protocol/schemas';

import {
  buyGift,
  claimGiftBySignature,
  harness,
  hcsMessages,
  iccidOf,
  provisioned,
  redeemPin,
  seedCard,
  topUp,
} from './fixture.js';

const SCAN = new URL('../../../../security/redteam/tools/scan.sh', import.meta.url).pathname;

describe('attack: LPA delivery and ledger content (AP4)', () => {
  it('the sealed LPA opens with the session secret; /me ×3 never shows it, the ICCID or its sealed form', async () => {
    const h = await harness();
    const { body, keys, challenge, path, key } = await provisioned(h);
    expect(
      openLpa(
        body.sealedLpa as SealedBox,
        keys.secretKey,
        lpaAad(challenge.nonce as `0x${string}`, key),
      ),
    ).toMatch(/^LPA:1\$local\.test\$/);
    for (let i = 0; i < 3; i++) {
      const text = await (await h.get(`/me/${path}`)).text();
      expect(text).not.toMatch(/sealedLpa|"lpa"|iccidEnc|sealedRef|LPA:/);
      expect(text).not.toContain(iccidOf(h, key));
    }
  });

  it('error paths: blobs.put or the ready patch failing ⇒ 5xx whose body and logs hold no LPA and no sealed box', async () => {
    const h = await harness();
    vi.spyOn(h.adapters.blobs, 'put').mockRejectedValueOnce(new Error('swarm down'));
    const a = await h.claim({ seed: 'blob-fail' });
    const update = vi
      .spyOn(h.adapters.ledger, 'update')
      .mockRejectedValueOnce(new Error('arkiv down'));
    h.clock.advance(61_000);
    const b = await h.claim({ seed: 'patch-fail' });
    update.mockRestore();
    for (const res of [a.res, b.res]) {
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(await res.text()).not.toMatch(/LPA:|sealedLpa|"ct"/);
    }
    expect(h.lines.join('')).not.toMatch(/LPA:1\$|"ct":/);
  });

  it('dump: ledger payloads + annotations and HCS messages scan clean; schema-level checks', async () => {
    const h = await harness();
    const { key } = await provisioned(h);
    await topUp(h, key);
    const gift = await buyGift(h);
    await claimGiftBySignature(h, gift.giftId, anvilKeys[1]);
    await redeemPin(h, (await seedCard(h)).pin);
    const ledger = await h.adapters.ledger.query();
    const hcs = h.consensus.messages(h.deps.env.HCS_TOPIC_ID);
    const dir = mkdtempSync(join(tmpdir(), 'recharge-redteam-'));
    writeFileSync(join(dir, 'ledger-dump.json'), JSON.stringify(ledger, null, 2));
    writeFileSync(join(dir, 'hcs-dump.json'), JSON.stringify(hcs, null, 2));
    const scan = spawnSync('bash', [SCAN, dir], { encoding: 'utf8' });
    expect(scan.stdout + scan.stderr).toMatch(/scan: clean/);
    expect(scan.status).toBe(0);
    for (const e of ledger) {
      const p = JSON.parse(e.payload) as Record<string, unknown>;
      expect(Object.keys(p)).not.toEqual(expect.arrayContaining(['iccid']));
      expect(Object.keys(p)).not.toEqual(expect.arrayContaining(['pin']));
      if (e.annotations.type === 'receipt') expect(p).not.toHaveProperty('entitlementKey');
    }
    for (const m of hcs) {
      expect(Buffer.byteLength(m)).toBeLessThanOrEqual(HCS_MAX_BYTES);
      expect(
        Object.keys(JSON.parse(m) as object).some((k) => /lpa|iccid|nullifier|pin/i.test(k)),
      ).toBe(false);
    }
    expect(hcsMessages(h).map((m) => m.t)).toEqual([
      'claim',
      'settle',
      'gift',
      'gift-claim',
      'card-redeem',
    ]);
  });
});
