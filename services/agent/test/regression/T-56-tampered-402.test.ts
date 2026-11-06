/**
 * T-56 / red team AG2 — the agent never signs a tampered 402. Each row mutates one field of the legitimate accepts[]
 * entry (or the envelope); "signatures" counts signTypedData / Hedera transaction builds actually produced.
 */
import { describe, expect, it } from 'vitest';

import type { PaymentRequired, PaymentRequirements } from '@ethglobal/protocol/schemas';

import {
  buyOnce,
  EVM_ACCEPT,
  harness,
  HEDERA_ACCEPT,
  hederaPayer,
  PAYOUT,
  skips,
  STRANGER,
  type Harness,
} from '../helpers.js';

type Mutation = (r: PaymentRequired) => PaymentRequired | string;
const first =
  (fn: (a: PaymentRequirements) => Record<string, unknown>): Mutation =>
  (r) =>
    ({ ...r, accepts: r.accepts.map((a, i) => (i === 0 ? fn(a) : a)) }) as PaymentRequired;
/** A header the codec itself refuses: base64 of whatever JSON the attacker wants. */
const raw = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64');

async function evmOnly(
  mutate: Mutation,
): Promise<{ h: Harness; out: Awaited<ReturnType<typeof buyOnce>> }> {
  const h = await harness({ api: { mutate } });
  return { h, out: await buyOnce(h) };
}
async function hederaFirst(
  mutate: Mutation,
): Promise<{ h: Harness; out: Awaited<ReturnType<typeof buyOnce>> }> {
  const h = await harness({
    api: { accepts: [HEDERA_ACCEPT, EVM_ACCEPT], mutate },
    payers: (evm) => [hederaPayer(), evm],
  });
  return { h, out: await buyOnce(h) };
}

describe('T-56 tampered 402 (AG2): no signature for a mutated entry', () => {
  const evmRows: [string, Mutation, string][] = [
    ['amount ×10', first((a) => ({ ...a, amount: '4000000' })), 'amount'],
    ['amount 399999', first((a) => ({ ...a, amount: '399999' })), 'amount'],
    ['payTo stranger', first((a) => ({ ...a, payTo: STRANGER })), 'payTo'],
    [
      'asset another token',
      first((a) => ({ ...a, asset: '0x0000000000000000000000000000000000000bad' })),
      'asset',
    ],
    ['network eip155:1', first((a) => ({ ...a, network: 'eip155:1' })), 'network'],
    [
      'network eip155:84532 (not allow-listed)',
      first((a) => ({ ...a, network: 'eip155:84532' })),
      'network',
    ],
    [
      'extra.name Fake USD (≠ readDomain)',
      first((a) => ({ ...a, extra: { ...a.extra, name: 'Fake USD' } })),
      'domain-mismatch',
    ],
  ];
  for (const [name, mutate, field] of evmRows) {
    it(`EVM ${name} → no signature, agent.skip field ${field}`, async () => {
      const { h, out } = await evmOnly(mutate);
      expect(out.signatures).toBe(0);
      expect(out.skipped).toBe('no-acceptable-terms');
      expect(skips(h).find((s) => s.reason === 'no-acceptable-terms')?.field).toBe(field);
      expect(h.api.paid).toHaveLength(0);
    });
  }

  const envelopeRows: [string, Mutation][] = [
    [
      'amount 400000.0 (not base units)',
      (r) => raw({ ...r, accepts: [{ ...r.accepts[0], amount: '400000.0' }] }),
    ],
    ['x402Version 1', (r) => raw({ ...r, x402Version: 1 })],
    [
      'maxAmountRequired instead of amount (v1)',
      (r) => {
        const { amount, ...rest } = r.accepts[0]!;
        return raw({ ...r, accepts: [{ ...rest, maxAmountRequired: amount }] });
      },
    ],
    ['9 entries', (r) => raw({ ...r, accepts: Array.from({ length: 9 }, () => r.accepts[0]) })],
    ['100 KiB header', () => 'A'.repeat(100 * 1024)],
    [
      'Hedera alias payTo',
      (r) =>
        raw({
          ...r,
          accepts: [{ ...HEDERA_ACCEPT, amount: '400000', payTo: '0.0.302a300506032b6570' }],
        }),
    ],
    [
      'Hedera maxTimeoutSeconds 3600',
      (r) =>
        raw({ ...r, accepts: [{ ...HEDERA_ACCEPT, amount: '400000', maxTimeoutSeconds: 3600 }] }),
    ],
  ];
  for (const [name, mutate] of envelopeRows) {
    it(`${name} → rejected by the codec before any signing work`, async () => {
      const { h, out } = await hederaFirst(mutate);
      expect(out.signatures).toBe(0);
      expect(out.skipped).toBe('invalid-402');
      expect(h.api.paid).toHaveLength(0);
    });
  }

  const hederaRows: [string, Mutation, string][] = [
    ['asset 0.0.0 (HBAR)', first((a) => ({ ...a, asset: '0.0.0' })), 'asset'],
    ['network hedera:mainnet', first((a) => ({ ...a, network: 'hedera:mainnet' })), 'network'],
    ['payTo another account', first((a) => ({ ...a, payTo: '0.0.7777' })), 'payTo'],
    [
      'extra.feePayer unpinned',
      first((a) => ({ ...a, extra: { ...a.extra, feePayer: '0.0.6666' } })),
      'fee-payer',
    ],
  ];
  for (const [name, mutate, field] of hederaRows) {
    it(`Hedera ${name} → the Hedera entry is never signed (field ${field})`, async () => {
      const h = await harness({
        api: { accepts: [HEDERA_ACCEPT], mutate },
        payers: (evm) => [hederaPayer(), evm],
      });
      const out = await buyOnce(h);
      expect(out.signatures).toBe(0);
      expect(skips(h).find((s) => s.reason === 'no-acceptable-terms')?.field).toBe(field);
    });
  }

  it('legitimate entry second, hostile first → signs the legitimate one only (no "first entry" bug)', async () => {
    const hostile = { ...EVM_ACCEPT, payTo: STRANGER };
    const h = await harness({ api: { accepts: [hostile, EVM_ACCEPT] } });
    const out = await buyOnce(h);
    expect(out.signatures).toBe(1);
    expect(h.api.paid[0]?.accepted.payTo).toBe(PAYOUT);
    expect(out.bought).toBeDefined();
  });

  it('PAYMENT-REQUIRED header and body disagree → the header is used, never a mix', async () => {
    // the body (hostile) differs from the header (legitimate): the client only reads the header
    const h = await harness({
      api: {
        body: (r) => ({
          ...r,
          accepts: r.accepts.map((a) => ({ ...a, payTo: STRANGER, amount: '4000000' })),
        }),
      },
    });
    const out = await buyOnce(h);
    expect(out.signatures).toBe(1);
    expect(h.api.paid[0]?.accepted.payTo).toBe(PAYOUT);
  });

  it('a lying /plans (price ×20, still under the daily cap) is caught by AGENT_MAX_USD6_PER_STEP → no request, no signature', async () => {
    const h = await harness({ api: { plansPriceUsd6PerStep: 8_000_000n } });
    const out = await buyOnce(h);
    expect(out).toMatchObject({ skipped: 'over-max-per-step', signatures: 0 });
    expect(h.api.topups).toHaveLength(0);
  });

  it('amount above AGENT_MAX_USD6_PER_STEP (both /plans and the 402 agree) → skip', async () => {
    const h = await harness({ env: { AGENT_MAX_USD6_PER_STEP: '300000' } });
    expect(await buyOnce(h)).toMatchObject({ skipped: 'over-max-per-step', signatures: 0 });
  });

  it('the value signed equals priceUsd6(mb, STEP_MB, /plans price) computed by the agent', async () => {
    const h = await harness();
    await buyOnce(h);
    const p = h.api.paid[0]?.payload;
    expect(p && 'authorization' in p ? p.authorization.value : undefined).toBe('400000');
  });
});
