import { describe, expect, it, vi } from 'vitest';

import {
  anvilAccounts,
  anvilRoles,
  fixtureProof,
  paymentPayload,
} from '@ethglobal/adapters/testing';
import { keccak256, utf8 } from '@ethglobal/crypto';
import { keys, NETWORKS, WORLD_ACTION, type Hex } from '@ethglobal/protocol/ids';
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResult,
} from '@ethglobal/protocol/schemas';
import { sessionNonce } from '@ethglobal/protocol/x402';

import {
  campaign,
  CAMPAIGN_ID,
  claimChallenge,
  counters,
  deps,
  failing,
  freeReq,
  ledgerWith,
  NULLIFIER,
  permissive,
  resource,
  SECRET,
  SPK,
  T0,
  type TestDeps,
} from './helpers.js';
import {
  buildAccepts,
  decide,
  DEVICE_TIER_DETAIL,
  EntitlementStore,
  freeEntitlementKey,
  holderHash,
  paidEntitlementKey,
  quotaKey,
  type DecideRequest,
  type Decision,
  type OctroiDeps,
} from '../src/index.js';

const offer = (d: OctroiDeps, mb: number, sessionKeyRequired = false, i = 0) =>
  buildAccepts(d, mb, { sessionKeyRequired })[i]!;
const pay = (
  d: OctroiDeps,
  mb: number,
  over: Parameters<typeof paymentPayload>[1] = {},
  lpa = false,
) => paymentPayload(offer(d, mb, lpa), over);
const paid = (d: OctroiDeps, over: Partial<DecideRequest> = {}) =>
  decide({ resource, mb: 100, payment: pay(d, 100), ...over }, d);
const denied = (reason: string, detail?: string) =>
  detail === undefined ? { kind: 'deny', reason } : { kind: 'deny', reason, detail };
const asFree = (r: Decision) => {
  if (r.kind !== 'serve-free') throw new Error(`expected serve-free, got ${JSON.stringify(r)}`);
  return r;
};

describe('decide — free lane', () => {
  it('valid orb proof + budget → serve-free with 300 MB (O1)', async () => {
    const d = deps();
    const r = asFree(await decide(freeReq(d), d));
    expect(r).toMatchObject({ tier: 'orb', mb: 300 });
    expect(r.entitlement).toMatchObject({
      kind: 'free',
      status: 'pending-profile',
      mbTotal: 300,
      mbUsed: 0,
      campaignId: campaign().id,
      planId: 'in-1gb-7d',
      expiresAt: T0 + 7 * 86_400_000,
    });
    expect(r.entitlement.key.startsWith('ent:v1:0x')).toBe(true);
  });

  it('a document credential is sized like orb', async () => {
    const d = deps();
    const ch = claimChallenge(d);
    const r = await decide(
      freeReq(d, { challenge: ch, proof: fixtureProof('document', ch.signal) }),
      d,
    );
    expect(r).toMatchObject({ kind: 'serve-free', tier: 'document', mb: 300 });
  });

  it('same nullifier twice → deny replay', async () => {
    const d = deps();
    expect((await decide(freeReq(d), d)).kind).toBe('serve-free');
    expect(await decide(freeReq(d), d)).toMatchObject(denied('replay', 'already_verified'));
    // permissive verifier: the engine's own ledger lookup of ent:v1:<quotaKey> denies
    const p = deps({ personhood: permissive() });
    const first = asFree(await decide(freeReq(p), p));
    await new EntitlementStore(p.ledger, p.now).create(first.entitlement);
    expect(await decide(freeReq(p), p)).toEqual(denied('replay'));
    expect(await decide(freeReq(p, { existingEntitlement: first.entitlement }), p)).toEqual(
      denied('replay'),
    );
  });

  it('counters.claimed → deny replay', async () => {
    const d = deps({ personhood: permissive() });
    expect(await decide(freeReq(d, { counters: counters({ claimed: true }) }), d)).toEqual(
      denied('replay'),
    );
  });

  it('paused campaign → deny paused and verify never called (spy) (O7)', async () => {
    const d = deps();
    const verify = vi.spyOn(d.personhood, 'verify');
    const put = vi.spyOn(d.ledger, 'put');
    expect(await decide(freeReq(d, { counters: counters({ paused: true }) }), d)).toEqual(
      denied('paused'),
    );
    expect(verify).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('expired campaign → deny expired', async () => {
    const d = deps();
    expect(await decide(freeReq(d, { campaign: campaign({ expiresAt: T0 }) }), d)).toEqual(
      denied('expired'),
    );
  });

  it('hourly cap at N+1 → deny cap', async () => {
    const d = deps({ personhood: permissive() });
    expect((await decide(freeReq(d, { counters: counters({ claimsThisHour: 4 }) }), d)).kind).toBe(
      'serve-free',
    );
    expect(await decide(freeReq(d, { counters: counters({ claimsThisHour: 5 }) }), d)).toEqual(
      denied('cap'),
    );
  });

  it('the lifetime claim cap survives an hour reset and blocks verification despite unused budget', async () => {
    const d = deps();
    const verify = vi.spyOn(d.personhood, 'verify');
    const put = vi.spyOn(d.ledger, 'put');
    const c = campaign({ maxClaims: 2 });
    const ct = counters({
      budgetUsd6: 100n * c.pricePerClaimUsd6,
      spentUsd6: 2n * c.pricePerClaimUsd6,
      claimsThisHour: 0,
      hourBucket: counters().hourBucket - 1,
    });
    expect(await decide(freeReq(d, { campaign: c, counters: ct }), d)).toEqual(denied('cap'));
    expect(verify).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('a count from an earlier hour bucket no longer applies', async () => {
    const d = deps({ personhood: permissive() });
    const ct = counters({ claimsThisHour: 5, hourBucket: counters().hourBucket - 1 });
    expect((await decide(freeReq(d, { counters: ct }), d)).kind).toBe('serve-free');
  });

  it('budget exhausted → deny budget', async () => {
    const d = deps();
    const exact = counters({ budgetUsd6: 1_000_000n, spentUsd6: 500_000n });
    expect((await decide(freeReq(d, { counters: exact }), d)).kind).toBe('serve-free');
    const over = counters({ budgetUsd6: 1_000_000n, spentUsd6: 500_001n });
    expect(await decide(freeReq(d, { counters: over }), d)).toEqual(denied('budget'));
  });

  it('device level → payment-required with both accepts (O5)', async () => {
    const d = deps();
    const ch = claimChallenge(d);
    const r = await decide(
      freeReq(d, { challenge: ch, proof: fixtureProof('device', ch.signal) }),
      d,
    );
    if (r.kind !== 'payment-required') throw new Error(r.kind);
    expect(r.body.error).toBe(DEVICE_TIER_DETAIL);
    // the human price of one 1 GB plan (PLAN_MB = 10 steps of $0.40), never a lone 100 MB step
    expect(r.body.accepts.map((a) => [a.network, a.amount, a.extra?.mb])).toEqual([
      [NETWORKS.anvil, '4000000', 1000],
      [NETWORKS.hederaTestnet, '4000000', 1000],
    ]);
  });

  it('body says orb, verifier says device → 0 MB (O5)', async () => {
    const d = deps({ personhood: permissive('device') });
    const r = await decide(freeReq(d), d); // fixture body is orb-shaped
    expect(r.kind).toBe('payment-required');
  });

  it('proof for another signal → invalid-proof (O2)', async () => {
    const d = deps();
    const other = claimChallenge(d);
    const r = await decide(freeReq(d, { proof: fixtureProof('orb', other.signal) }), d);
    expect(r).toEqual(denied('invalid-proof', 'invalid_proof'));
  });

  it('passes the recomputed signal and the action to verify', async () => {
    const d = deps();
    const verify = vi.spyOn(d.personhood, 'verify');
    const ch = claimChallenge(d);
    await decide(freeReq(d, { challenge: ch }), d);
    expect(verify).toHaveBeenCalledWith(expect.anything(), {
      action: WORLD_ACTION,
      signal: ch.signal,
    });
  });

  it('a verifier error without a code is invalid-proof', async () => {
    const d = deps({ personhood: { verify: failing } });
    expect(await decide(freeReq(d), d)).toEqual(denied('invalid-proof', 'error'));
  });

  it.each([
    ['no campaign', { campaign: undefined }, denied('no-campaign')],
    ['no challenge', { challenge: undefined }, denied('invalid-request', 'challenge_required')],
    [
      'no session key',
      { sessionPubKey: undefined },
      denied('invalid-request', 'challenge_required'),
    ],
    ['no counters', { counters: undefined }, denied('invalid-request', 'challenge_required')],
  ] as const)('%s → deny before anything else', async (_n, over, expected) => {
    const d = deps();
    expect(await decide(freeReq(d, over), d)).toEqual(expected);
  });

  it('a challenge for another route or audience → invalid-proof (O4)', async () => {
    const d = deps();
    for (const over of [{ path: '/gift/claim' as const }, { audience: 'evil' }]) {
      const ch = { ...claimChallenge(d), ...over };
      expect(await decide(freeReq(d, { challenge: ch }), d)).toEqual(
        denied('invalid-proof', 'challenge_route'),
      );
    }
  });

  it('a stale or foreign challenge → invalid-proof; a reused one → replay', async () => {
    const d = deps();
    const ch = claimChallenge(d);
    d.clock.advance(121_000);
    expect(await decide(freeReq(d, { challenge: ch }), d)).toEqual(
      denied('invalid-proof', 'challenge_expired'),
    );
    const fresh = claimChallenge(d);
    expect(
      await decide(freeReq(d, { challenge: fresh, sessionPubKey: `0x${'01'.repeat(32)}` }), d),
    ).toEqual(denied('invalid-proof', 'challenge_invalid'));
    expect((await decide(freeReq(d, { challenge: fresh }), d)).kind).toBe('serve-free');
    expect(await decide(freeReq(d, { challenge: fresh }), d)).toEqual(
      denied('replay', 'challenge'),
    );
  });

  it('the default nonce cache is per ledger and prunes expired entries; an injected one is used as is', async () => {
    const d = deps({ personhood: permissive() });
    await decide(freeReq(d), d);
    d.clock.advance(200_000);
    // pruned; a fresh challenge from another human serves (the same human is now a replay: claim lock, A-33)
    const other = { ...d, personhood: permissive('orb', `0x${'d4'.repeat(32)}`) };
    expect((await decide(freeReq(other), other)).kind).toBe('serve-free');
    const nonceCache = new Set<string>();
    const e = deps({ personhood: permissive(), nonceCache });
    const ch = claimChallenge(e);
    await decide(freeReq(e, { challenge: ch }), e);
    expect(nonceCache.has(ch.nonce)).toBe(true);
  });

  it('ledger unavailable during consume → ledger-unavailable', async () => {
    const d = deps();
    const broken = { ...d, ledger: ledgerWith(d.ledger, { put: failing }) };
    const verify = vi.spyOn(d.personhood, 'verify');
    expect(await decide(freeReq(broken), broken)).toEqual(denied('ledger-unavailable', 'nonce'));
    expect(verify).not.toHaveBeenCalled();
  });

  it('ledger unavailable during the entitlement lookup → ledger-unavailable', async () => {
    const d = deps({ personhood: permissive() });
    const ledger = ledgerWith(d.ledger, {
      query: (q) => (q?.annotations?.type === 'entitlement' ? failing() : d.ledger.query(q)),
    });
    const broken: TestDeps = { ...d, ledger };
    expect(await decide(freeReq(broken), broken)).toEqual(
      denied('ledger-unavailable', 'entitlement'),
    );
  });

  it('actionCheck false → invalid-proof', async () => {
    const d = deps({ personhood: permissive() });
    const no = campaign({ actionCheck: async () => false });
    expect(await decide(freeReq(d, { campaign: no }), d)).toEqual(
      denied('invalid-proof', 'action'),
    );
    const throws = campaign({ actionCheck: failing });
    expect(await decide(freeReq(d, { campaign: throws }), d)).toEqual(
      denied('invalid-proof', 'action'),
    );
    const seen: Hex[] = [];
    const yes = campaign({ actionCheck: async (k) => seen.push(k) > 0 });
    const r = asFree(await decide(freeReq(d, { campaign: yes }), d));
    expect(seen).toEqual([r.claimKey]);
  });

  it('keys: the entitlement capability is per campaign (A-34), never the global pseudonym', async () => {
    const d = deps({ personhood: permissive() });
    const r = asFree(await decide(freeReq(d), d));
    expect(r.entitlement.key).toBe(freeEntitlementKey(SECRET, CAMPAIGN_ID, NULLIFIER));
    expect(r.entitlement.key).not.toBe(keys.entitlementFree(quotaKey(SECRET, NULLIFIER)));
    expect(r.entitlement.holderHash).toBe(holderHash(r.entitlement.key, SPK));
    expect(JSON.stringify(r)).not.toContain(NULLIFIER.slice(2, 14));
  });
});

describe('decide — request validity', () => {
  it('no proof no payment → payment-required with amount = steps × price', async () => {
    const d = deps();
    const r = await decide({ resource, mb: 300, requireSessionKey: true }, d);
    if (r.kind !== 'payment-required') throw new Error(r.kind);
    expect(r.body).toMatchObject({ x402Version: 2, resource, error: 'payment required' });
    expect(r.body.accepts).toHaveLength(2);
    for (const a of r.body.accepts) {
      expect(a.amount).toBe('1200000');
      expect(a.extra).toMatchObject({ mb: 300, stepMb: 100, sessionKeyRequired: true });
      expect(a).not.toHaveProperty('maxAmountRequired');
    }
  });

  it.each([199, 0, -100, 3100, Number.NaN, 100.5])('mb = %s → invalid-request (O9)', async (mb) => {
    const d = deps();
    expect((await decide({ resource, mb }, d)).kind).toBe('deny');
    expect(await decide({ resource, mb, payment: pay(d, 100) }, d)).toMatchObject({
      reason: 'invalid-request',
    });
  });

  it('both proof and payment → invalid-request', async () => {
    const d = deps();
    const r = await decide({ ...freeReq(d), mb: 100, payment: pay(d, 100) }, d);
    expect(r).toEqual(denied('invalid-request', 'proof_and_payment'));
  });
});

describe('decide — paid lane', () => {
  it('valid payment → serve-paid with key paid:<payer>:HMAC(network, payer, nonce) and expiresAt = now + validity', async () => {
    const d = deps({ planId: 'in-topup' });
    const r = await paid(d);
    if (r.kind !== 'serve-paid') throw new Error(JSON.stringify(r));
    const payer = anvilAccounts[anvilRoles.human];
    expect(r.entitlement).toMatchObject({
      key: paidEntitlementKey(SECRET, NETWORKS.anvil, payer, `0x${'01'.padStart(64, '0')}`),
      kind: 'paid',
      tier: 'none',
      mbTotal: 100,
      payer,
      network: NETWORKS.anvil,
      planId: 'in-topup',
      expiresAt: T0 + 7 * 86_400_000,
    });
    expect(r.requirements).toEqual(offer(d, 100));
    expect(r.settlement.success).toBe(true);
  });

  it('payment for one step with mb = 200 → invalid-payment', async () => {
    const d = deps();
    expect(await decide({ resource, mb: 200, payment: pay(d, 100) }, d)).toEqual(
      denied('invalid-payment', 'requirements_mismatch'),
    );
  });

  it('over-payment → invalid-payment', async () => {
    const d = deps();
    expect(await paid(d, { payment: pay(d, 100, { value: '800000' }) })).toEqual(
      denied('invalid-payment', 'amount_mismatch'),
    );
  });

  it('authorization.to other than payTo → invalid-payment', async () => {
    const d = deps();
    expect(await paid(d, { payment: pay(d, 100, { to: anvilAccounts[7] }) })).toEqual(
      denied('invalid-payment', 'recipient_mismatch'),
    );
  });

  it.each([
    ['network', { network: 'eip155:1' }],
    ['asset', { asset: anvilAccounts[8] }],
    ['payTo', { payTo: anvilAccounts[7] }],
    ['amount', { amount: '1' }],
    ['maxTimeoutSeconds', { maxTimeoutSeconds: 9999 }],
    [
      'extra.name',
      {
        extra: { name: 'Fake USD', version: '2', mb: 100, stepMb: 100, sessionKeyRequired: false },
      },
    ],
    [
      'extra.mb',
      {
        extra: { name: 'USD Coin', version: '2', mb: 300, stepMb: 100, sessionKeyRequired: false },
      },
    ],
    ['added maxAmountRequired', { maxAmountRequired: '1' }],
  ])(
    'tampered accepts field (each of network/asset/payTo/amount) → invalid-payment (O11): %s',
    async (_f, over) => {
      const d = deps();
      const accepted = { ...offer(d, 100), ...over } as PaymentRequirements;
      const payment = paymentPayload(accepted);
      expect(await paid(d, { payment })).toEqual(
        denied('invalid-payment', 'requirements_mismatch'),
      );
    },
  );

  it('addresses compare case-insensitively on EVM; a garbage echo never matches', async () => {
    const d = deps();
    const o = offer(d, 100);
    const shouty = {
      ...o,
      asset: o.asset.toUpperCase().replace('0X', '0x'),
      payTo: o.payTo.toLowerCase(),
    };
    expect((await paid(d, { payment: paymentPayload(shouty) })).kind).toBe('serve-paid');
    for (const accepted of [null, 'x', undefined, { ...o, asset: 7 }, { ...o, extra: { n: 1n } }]) {
      const payment = { ...pay(d, 100), accepted } as unknown as PaymentPayload;
      expect(await paid(d, { payment })).toEqual(
        denied('invalid-payment', 'requirements_mismatch'),
      );
    }
  });

  it('a payload that fails the x402 schema → invalid-payment', async () => {
    const d = deps();
    const bad = pay(d, 100);
    const payment = { ...bad, payload: { ...bad.payload, signature: 'nope' } } as PaymentPayload;
    expect(await paid(d, { payment })).toEqual(denied('invalid-payment', 'malformed_payload'));
  });

  it('nonce ≠ keccak(sessionPubKey) on an LPA route → invalid-payment (C4)', async () => {
    const d = deps();
    const bound = sessionNonce(SPK, keccak256);
    const lpa = { requireSessionKey: true, sessionPubKey: SPK } as const;
    expect(await paid(d, { ...lpa, payment: pay(d, 100, {}, true) })).toEqual(
      denied('invalid-payment', 'session_binding'),
    );
    expect((await paid(d, { ...lpa, payment: pay(d, 100, { nonce: bound }, true) })).kind).toBe(
      'serve-paid',
    );
    const other: Hex = `0x${'99'.repeat(32)}`;
    const swapped = { ...lpa, sessionPubKey: other };
    expect(
      await paid(d, { ...swapped, payment: pay(d, 100, { nonce: bound }, true) }),
    ).toMatchObject({
      reason: 'invalid-payment',
    });
    expect(await paid(d, { requireSessionKey: true, payment: pay(d, 100, {}, true) })).toEqual(
      denied('invalid-request', 'session_key_required'),
    );
    expect(
      await paid(d, { ...lpa, sessionPubKey: '0x12', payment: pay(d, 100, {}, true) }),
    ).toEqual(denied('invalid-request', 'session_key'));
    expect(
      (await paid(deps(), { payment: pay(d, 100, { nonce: `0x${'77'.repeat(32)}` }) })).kind,
    ).toBe('serve-paid');
  });

  it('settle fails → invalid-payment (O10)', async () => {
    const d = deps();
    const settle = (result: unknown) => ({
      ...d,
      payments: {
        ...d.payments,
        verify: d.payments.verify.bind(d.payments),
        settle: async () => result as SettleResult,
      },
    });
    const ok = {
      success: true,
      transaction: `0x${'aa'.repeat(32)}`,
      network: NETWORKS.anvil,
      payer: anvilAccounts[anvilRoles.human],
    };
    const cases: [unknown, string][] = [
      [
        { success: false, errorReason: 'insufficient_funds', network: NETWORKS.anvil },
        'insufficient_funds',
      ],
      [
        {
          success: false,
          errorReason: 'settlement_pending',
          network: NETWORKS.anvil,
          transaction: ok.transaction,
        },
        'settlement_pending',
      ],
      [{ ...ok, transaction: '0x12' }, 'settlement_malformed'],
      [{ ...ok, transaction: '0.0.1234@1700000000.000000001' }, 'settlement_tx'],
      [{ ...ok, network: NETWORKS.baseSepolia }, 'settlement_network'],
      [{ ...ok, payer: anvilAccounts[4] }, 'settlement_payer'],
    ];
    for (const [result, detail] of cases) {
      const dd = settle(result);
      expect(await paid(dd, { payment: pay(dd, 100) })).toEqual(denied('invalid-payment', detail));
    }
    const throwing = {
      ...d,
      payments: {
        ...d.payments,
        verify: async () => ({ isValid: true as const, payer: 'x' }),
        settle: failing,
      },
    };
    expect(await paid(throwing)).toEqual(denied('invalid-payment', 'settle_error'));
  });

  it('verify false or throwing → invalid-payment and settle never called', async () => {
    const d = deps();
    const settle = vi.spyOn(d.payments, 'settle');
    const stale = pay(d, 100, { validBefore: String(Math.floor(T0 / 1000) - 1) });
    expect(await paid(d, { payment: stale })).toEqual(denied('invalid-payment', 'expired'));
    const throwing = { ...d, payments: { ...d.payments, verify: failing } };
    expect(await paid(throwing)).toEqual(denied('invalid-payment', 'verify_error'));
    expect(settle).not.toHaveBeenCalled();
  });

  it('Hedera: served on a valid settlement keyed by the transaction; refused on an LPA route', async () => {
    const tx = '0.0.4242@1762171200.000000001';
    const d = deps();
    const hd: TestDeps = {
      ...d,
      payments: {
        createPaymentRequirement: d.payments.createPaymentRequirement.bind(d.payments),
        verify: async () => ({ isValid: true, payer: '0.0.777' }),
        settle: async () => ({
          success: true,
          transaction: tx,
          network: NETWORKS.hederaTestnet,
          payer: '0.0.777',
        }),
      },
    };
    const payment: PaymentPayload = {
      x402Version: 2,
      accepted: offer(hd, 100, false, 1),
      payload: { transaction: 'AAAA' },
    };
    const r = await paid(hd, { payment });
    expect(r).toMatchObject({
      kind: 'serve-paid',
      entitlement: {
        key: paidEntitlementKey(SECRET, NETWORKS.hederaTestnet, '0.0.777', keccak256(utf8(tx))),
        network: NETWORKS.hederaTestnet,
      },
    });
    const lpaPayment = { ...payment, accepted: offer(hd, 100, true, 1) };
    expect(
      await paid(hd, { payment: lpaPayment, requireSessionKey: true, sessionPubKey: SPK }),
    ).toEqual(denied('invalid-payment', 'session_binding_unsupported'));
  });

  it('decide() persists only the consumed nonce and the claim locks / settlement marker (O8, A-33)', async () => {
    const d = deps();
    await decide(freeReq(d), d);
    await paid(d);
    const all = await d.ledger.query({});
    // free: nonce + live locks (today, tomorrow: A-44) + campaign record; paid: settlement marker. Never an entitlement.
    expect(all.map((e) => e.annotations.type)).toEqual([
      'nonce',
      'claim',
      'claim',
      'claim',
      'claim',
    ]);
    expect(all.map((e) => (JSON.parse(e.payload) as { scope: string }).scope).slice(1)).toEqual([
      'free-live',
      'free-live',
      'free-campaign',
      'settlement',
    ]);
  });
});
