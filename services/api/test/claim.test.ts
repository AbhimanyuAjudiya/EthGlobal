import { describe, expect, it, vi } from 'vitest';

import { fixtureProof, T0 } from '@ethglobal/adapters/testing';
import { bytesToHex, generateSessionKeypair } from '@ethglobal/crypto';
import { paymentRequiredSchema } from '@ethglobal/protocol/schemas';

import { DAY, errorOf, harness, provisioned } from './support/harness.js';

describe('POST /claim', () => {
  it('Orb fixture proof → 201 with sealedLpa, claimTx, receipt.hcs.sequence 1 and expiresAt = now + validity', async () => {
    const h = await harness();
    const { body } = await provisioned(h);
    expect(body).toMatchObject({
      kind: 'free',
      status: 'ready',
      tier: 'orb',
      mbTotal: 300,
      validityDays: 7,
      expiresAt: T0 + 7 * DAY,
    });
    expect(body.sealedLpa).toBeDefined();
    expect(body.claimTx).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.receipt.hcs).toEqual({ topic: '0.0.1001', sequence: 1 });
  });

  it('a document-level proof sizes the bundle by the campaign economics (160 MB)', async () => {
    const h = await harness();
    const { res } = await h.claim({ level: 'document', seed: 'doc-human' });
    expect((await res.json()) as { mbTotal: number; tier: string }).toMatchObject({
      mbTotal: 160,
      tier: 'document',
    });
  });

  it('device-level proof → 402 with the human price, nothing claimed', async () => {
    const h = await harness();
    const { res } = await h.claim({ level: 'device' });
    expect(res.status).toBe(402);
    expect(paymentRequiredSchema.parse(await res.json()).accepts[0]?.amount).toBe('400000');
    expect(h.dataDrop.claimedEvents).toHaveLength(0);
  });

  it('same proof twice → 409 replay and exactly one DataDrop.claim', async () => {
    const h = await harness();
    await provisioned(h, 'twice');
    const again = await h.claim({ seed: 'twice' });
    expect([again.res.status, await errorOf(again.res)]).toEqual([409, 'replay']);
    expect(h.dataDrop.claimedEvents).toHaveLength(1);
  });

  it('paused campaign → 423 and personhood.verify never called (O7)', async () => {
    const h = await harness({ campaign: { paused: true } });
    const verify = vi.spyOn(h.adapters.personhood, 'verify');
    const { res } = await h.claim();
    expect([res.status, await errorOf(res)]).toEqual([423, 'campaign_paused']);
    expect(verify).not.toHaveBeenCalled();
  });

  it('expired, exhausted and unknown campaigns → 410, 409, 404 without verifying', async () => {
    // the chain ends the campaign before its ledger entity lapses (the entity's own expiry reads as 404)
    const expired = await harness();
    const onChain = expired.dataDrop.campaigns.get(expired.campaignId);
    if (onChain) onChain.expiresAt = T0 + 1000;
    expired.clock.advance(2000);
    expect((await expired.claim()).res.status).toBe(410);
    const broke = await harness({ campaign: { budget: 100n } });
    expect(await errorOf((await broke.claim()).res)).toBe('budget_exhausted');
    const unknown = await harness();
    const verify = vi.spyOn(unknown.adapters.personhood, 'verify');
    expect((await unknown.claim({ campaignId: `0x${'ab'.repeat(32)}` })).res.status).toBe(404);
    expect(verify).not.toHaveBeenCalled();
  });

  it('swapped sessionPubKey between /challenge and /claim → 401', async () => {
    const h = await harness();
    const a = bytesToHex(generateSessionKeypair().publicKey);
    const b = bytesToHex(generateSessionKeypair().publicKey);
    const ch = await h.challengeFor('/claim', a);
    const res = await h.json('/claim', {
      proof: fixtureProof('orb', ch.signal as `0x${string}`),
      campaignId: h.campaignId,
      challenge: ch,
      sessionPubKey: b,
    });
    expect([res.status, await errorOf(res)]).toEqual([401, 'invalid_proof']);
  });

  it('a proof whose signal_hash ≠ hashToField(challenge.signal) → 401; a staging-environment result → 401', async () => {
    const h = await harness();
    const spk = bytesToHex(generateSessionKeypair().publicKey);
    const ch = await h.challengeFor('/claim', spk);
    const other = await h.challengeFor('/claim', spk);
    const wrong = await h.json('/claim', {
      proof: fixtureProof('orb', other.signal as `0x${string}`),
      campaignId: h.campaignId,
      challenge: ch,
      sessionPubKey: spk,
    });
    expect(wrong.status).toBe(401);
    const ch2 = await h.challengeFor('/claim', spk);
    const staging = {
      ...fixtureProof('orb', ch2.signal as `0x${string}`, 'staging'),
      environment: 'staging',
    };
    expect(
      (
        await h.json('/claim', {
          proof: staging,
          campaignId: h.campaignId,
          challenge: ch2,
          sessionPubKey: spk,
        })
      ).status,
    ).toBe(401);
  });
});
