/**
 * Red team (wave 1, octroi): paid-lane attacks beyond wave1-octroi.md O9–O11 / C4.
 * Tests named `… [RT-O-0N]` were filed as findings and are now passing regressions; each one is
 * filed in security/redteam/findings/. Every other test is a passing regression naming the property it proves.
 */
import { describe, expect, it } from 'vitest';

import { MockPaymentRail, type PaymentRail } from '@ethglobal/adapters';
import { anvilAccounts, anvilRoles, paymentPayload } from '@ethglobal/adapters/testing';
import { keccak256 } from '@ethglobal/crypto';
import { NETWORKS } from '@ethglobal/protocol/ids';
import type { PaymentPayload, PaymentRequirements } from '@ethglobal/protocol/schemas';
import { sessionNonce } from '@ethglobal/protocol/x402';

import { buildAccepts, decide, type Decision } from '../../src/index.js';
import { deps, resource, SPK, OTHER_SPK, type TestDeps } from '../helpers.js';
import { concurrentPaid, settlingWith } from './rt-helpers.js';

const HEDERA_TX = '0.0.9185802@1762200000.000000001';
const HEDERA_PAYER = '0.0.777';
const TX_B64 = Buffer.from('partially-signed-hts-transfer-of-the-victim').toString('base64');

const evmOffer = (d: TestDeps, mb = 100, sessionKeyRequired = false): PaymentRequirements =>
  buildAccepts(d, mb, { sessionKeyRequired }).find((r) => r.network === NETWORKS.anvil)!;
const hederaOffer = (d: TestDeps, mb = 100, sessionKeyRequired = false): PaymentRequirements =>
  buildAccepts(d, mb, { sessionKeyRequired }).find((r) => r.network === NETWORKS.hederaTestnet)!;

/** An honest Hedera facilitator: the victim's HTS transaction is genuine, so verify and settle succeed. */
const honestHederaRail = (): PaymentRail & { settled: number } => {
  const rail = {
    settled: 0,
    createPaymentRequirement: () => {
      throw new Error('unused');
    },
    verify: async () => ({ isValid: true as const, payer: HEDERA_PAYER }),
    settle: async () => {
      rail.settled += 1;
      return {
        success: true as const,
        transaction: HEDERA_TX,
        network: NETWORKS.hederaTestnet,
        payer: HEDERA_PAYER,
      };
    },
  };
  return rail;
};

/**
 * A rail with SelfRunFacilitator's documented semantics (packages/adapters/src/live/self-run-facilitator.ts
 * settle(): "nonce_already_used ∧ matching Transfer ⇒ success with the found tx", T-15). verify() reports a
 * used nonce; settle() of an already-executed authorization returns the earlier transaction.
 */
const frontRunRecoveringRail = (): PaymentRail & { submissions: number } => {
  const executed = new Map<string, string>();
  const rail = {
    submissions: 0,
    createPaymentRequirement: () => {
      throw new Error('unused');
    },
    verify: async (p: PaymentPayload) => {
      const a = (p.payload as { authorization: { from: string; nonce: string } }).authorization;
      return executed.has(`${a.from}:${a.nonce}`)
        ? { isValid: false as const, invalidReason: 'nonce_already_used' }
        : { isValid: true as const, payer: a.from };
    },
    settle: async (p: PaymentPayload) => {
      const a = (p.payload as { authorization: { from: string; nonce: string } }).authorization;
      const id = `${a.from}:${a.nonce}`;
      await new Promise((r) => setTimeout(r, 1)); // the relayer waits for the receipt
      const found = executed.get(id);
      if (found)
        return {
          success: true as const,
          transaction: found,
          network: NETWORKS.anvil,
          payer: a.from,
        };
      rail.submissions += 1;
      const tx = `0x${String(rail.submissions).padStart(64, '0')}`;
      executed.set(id, tx);
      return { success: true as const, transaction: tx, network: NETWORKS.anvil, payer: a.from };
    },
  };
  return rail;
};

const served = (rs: Decision[]) => rs.filter((r) => r.kind === 'serve-paid');

describe('attack: rt hybrid Hedera payload on an LPA route (T-32, README decision 7)', () => {
  // Regression RT-O-02 (fixed)
  it('a Hedera payment with a decoy `authorization` beside `transaction` is still refused on an LPA route [RT-O-02]', async () => {
    const d = { ...deps(), payments: honestHederaRail() };
    const offered = hederaOffer(d, 100, true);
    // A MITM swaps X-Session-Pubkey to its own key and adds a decoy authorization whose nonce is
    // sessionNonce(attacker key). The victim's signed HTS transaction is untouched, so the facilitator settles it.
    const hybrid = {
      x402Version: 2,
      accepted: offered,
      payload: {
        transaction: TX_B64,
        authorization: {
          from: HEDERA_PAYER,
          to: offered.payTo,
          value: offered.amount,
          validAfter: '0',
          validBefore: '9999999999',
          nonce: sessionNonce(OTHER_SPK, keccak256),
        },
      },
    } as unknown as PaymentPayload;
    const r = await decide(
      { resource, mb: 100, payment: hybrid, requireSessionKey: true, sessionPubKey: OTHER_SPK },
      d,
    );
    expect(r).toMatchObject({ kind: 'deny', reason: 'invalid-payment' });
  });

  // Regression RT-O-02 (fixed) (same root cause: the raw payload, not the parsed one, decides isEvmExact)
  it('a hybrid Hedera payload whose decoy authorization has no `from` is a deny, not a thrown TypeError [RT-O-02]', async () => {
    const d = { ...deps(), payments: honestHederaRail() };
    const offered = hederaOffer(d);
    const hybrid = {
      x402Version: 2,
      accepted: offered,
      payload: { transaction: TX_B64, authorization: { to: offered.payTo, value: offered.amount } },
    } as unknown as PaymentPayload;
    await expect(decide({ resource, mb: 100, payment: hybrid }, d)).resolves.toMatchObject({
      kind: 'deny',
    });
  });

  // Property: a plain Hedera payload on an LPA route fails closed (decision 7 holds without the decoy).
  it('plain Hedera payload with requireSessionKey → session_binding_unsupported, settle never called', async () => {
    const rail = honestHederaRail();
    const d = { ...deps(), payments: rail };
    const offered = hederaOffer(d, 100, true);
    const payment = {
      x402Version: 2,
      accepted: offered,
      payload: { transaction: TX_B64 },
    } as PaymentPayload;
    const r = await decide(
      { resource, mb: 100, payment, requireSessionKey: true, sessionPubKey: SPK },
      d,
    );
    expect(r).toMatchObject({ kind: 'deny', detail: 'session_binding_unsupported' });
    expect(rail.settled).toBe(0);
  });

  // Property: the payload kind must match the accepted network (EVM network + Hedera payload is malformed).
  it('EVM accepted + Hedera payload → malformed_payload; Hedera accepted + EVM payload → mismatch/malformed', async () => {
    const d = deps();
    const evm = {
      x402Version: 2,
      accepted: evmOffer(d),
      payload: { transaction: TX_B64 },
    } as PaymentPayload;
    expect(await decide({ resource, mb: 100, payment: evm }, d)).toMatchObject({
      reason: 'invalid-payment',
      detail: 'malformed_payload',
    });
    const hed = paymentPayload(hederaOffer(d));
    expect(await decide({ resource, mb: 100, payment: hed }, d)).toMatchObject({
      reason: 'invalid-payment',
    });
  });
});

describe('attack: rt one payment, two serves (T-15, T-27)', () => {
  // Regression RT-O-05 (fixed)
  it('two concurrent decide() with the SAME signed payment serve at most once (front-run-recovering rail) [RT-O-05]', async () => {
    const rail = frontRunRecoveringRail();
    const d = { ...deps(), payments: rail };
    const payment = paymentPayload(evmOffer(d));
    const rs = await concurrentPaid(d, payment);
    expect(rail.submissions).toBe(1); // one transfer on chain …
    expect(served(rs)).toHaveLength(1); // … must mean one serve
  });

  // Property: sequential replay of a settled payment is refused by verify before settle.
  it('sequential replay of the same payment → deny (verify sees the used nonce)', async () => {
    const d = { ...deps(), payments: frontRunRecoveringRail() };
    const payment = paymentPayload(evmOffer(d));
    expect((await decide({ resource, mb: 100, payment }, d)).kind).toBe('serve-paid');
    expect(await decide({ resource, mb: 100, payment }, d)).toMatchObject({
      reason: 'invalid-payment',
      detail: 'nonce_already_used',
    });
  });

  // Property (mock parity gap, documented in RT-O-05): MockPaymentRail does not model front-run recovery.
  it('MockPaymentRail: concurrent same payment → exactly one serve-paid', async () => {
    const d = deps();
    const payment = paymentPayload(evmOffer(d));
    const rs = await concurrentPaid(d, payment);
    expect(served(rs)).toHaveLength(1);
  });

  // Regression RT-O-05 (fixed) (Hedera: the same settled transaction id returned for a resubmitted payload)
  it('the same Hedera settlement transaction is not served twice [RT-O-05]', async () => {
    const d = { ...deps(), payments: honestHederaRail() };
    const payment = {
      x402Version: 2,
      accepted: hederaOffer(d),
      payload: { transaction: TX_B64 },
    } as PaymentPayload;
    const a = await decide({ resource, mb: 100, payment }, d);
    const b = await decide({ resource, mb: 100, payment }, d);
    expect(served([a, b])).toHaveLength(1);
  });
});

describe('attack: rt requirements mismatch variants (T-26, T-28)', () => {
  const mutate = (
    d: TestDeps,
    f: (r: Record<string, unknown>) => void,
    auth: Record<string, string> = {},
  ) => {
    const r = structuredClone(evmOffer(d)) as unknown as Record<string, unknown>;
    f(r);
    return paymentPayload(r as unknown as PaymentRequirements, auth);
  };
  // Property: the accepted echo must canonical-JSON-equal the offer; any extra/renamed/re-cased field fails.
  it.each<[string, (r: Record<string, unknown>) => void]>([
    ['extra top-level key', (r) => (r.maxAmountRequired = '1')],
    ['extra key inside extra', (r) => ((r.extra as Record<string, unknown>).foo = 1)],
    ['extra.mb changed', (r) => ((r.extra as Record<string, unknown>).mb = 300)],
    [
      'extra.sessionKeyRequired flipped',
      (r) => ((r.extra as Record<string, unknown>).sessionKeyRequired = true),
    ],
    ['network upper-case', (r) => (r.network = String(r.network).toUpperCase())],
    ['scheme upper-case', (r) => (r.scheme = 'EXACT')],
    ['amount leading zero', (r) => (r.amount = `0${String(r.amount)}`)],
    ['amount trailing decimal', (r) => (r.amount = `${String(r.amount)}.0`)],
    ['amount as number', (r) => (r.amount = Number(r.amount))],
    ['amount with whitespace', (r) => (r.amount = `${String(r.amount)} `)],
    ['maxTimeoutSeconds +1', (r) => (r.maxTimeoutSeconds = Number(r.maxTimeoutSeconds) + 1)],
    ['extra.name changed', (r) => ((r.extra as Record<string, unknown>).name = 'USD Coin ')],
    [
      'extra.name unicode look-alike',
      (r) => ((r.extra as Record<string, unknown>).name = 'USDСoin'),
    ],
  ])('%s → requirements_mismatch', async (_n, f) => {
    const d = deps();
    expect(await decide({ resource, mb: 100, payment: mutate(d, f) }, d)).toMatchObject({
      reason: 'invalid-payment',
      detail: 'requirements_mismatch',
    });
  });

  // Property: address case on EVM is not a mismatch (asset/payTo compare lower-cased) and still settles once.
  it('asset and payTo re-cased on EVM → accepted (normalised), exact amount still enforced', async () => {
    const d = deps();
    const p = mutate(d, (r) => {
      r.asset = String(r.asset).toUpperCase().replace('0X', '0x');
      r.payTo = String(r.payTo).toLowerCase();
    });
    expect((await decide({ resource, mb: 100, payment: p }, d)).kind).toBe('serve-paid');
  });

  // Property: authorization.value must equal amount as a string (no numeric coercion of zero-padding).
  it.each(['0400000', '400000 ', '+400000', '400001', '399999'])(
    'authorization.value %j → deny',
    async (value) => {
      const d = deps();
      const p = mutate(d, () => undefined, { value });
      expect((await decide({ resource, mb: 100, payment: p }, d)).kind).toBe('deny');
    },
  );

  // Property: a settlement whose payer is not the authorization's `from` is refused (payer ≠ signer).
  it('settlement payer ≠ authorization.from → settlement_payer', async () => {
    const d = settlingWith(deps(), {
      success: true,
      transaction: `0x${'aa'.repeat(32)}`,
      network: NETWORKS.anvil,
      payer: anvilAccounts[anvilRoles.stranger],
    });
    expect(
      await decide({ resource, mb: 100, payment: paymentPayload(evmOffer(d)) }, d),
    ).toMatchObject({
      detail: 'settlement_payer',
    });
  });

  // Property: settlement_pending (non-terminal, A-18) never serves, even with a well-formed tx.
  it('settlement_pending with a tx → deny', async () => {
    const d = settlingWith(deps(), {
      success: false,
      errorReason: 'settlement_pending',
      network: NETWORKS.anvil,
      transaction: `0x${'bb'.repeat(32)}`,
    });
    expect(
      await decide({ resource, mb: 100, payment: paymentPayload(evmOffer(d)) }, d),
    ).toMatchObject({
      kind: 'deny',
      detail: 'settlement_pending',
    });
  });

  // Property: requireSessionKey binds the nonce to the X-Session-Pubkey; a re-cased SPK is the same key.
  it('session nonce: substituting the session key after signing → session_binding; re-cased key → same key', async () => {
    const d = deps();
    const offered = evmOffer(d, 100, true);
    const payment = paymentPayload(offered, { nonce: sessionNonce(SPK, keccak256) });
    expect(
      await decide(
        { resource, mb: 100, payment, requireSessionKey: true, sessionPubKey: OTHER_SPK },
        d,
      ),
    ).toMatchObject({ detail: 'session_binding' });
    const upper = SPK.toUpperCase().replace('0X', '0x') as typeof SPK;
    expect(
      (
        await decide(
          { resource, mb: 100, payment, requireSessionKey: true, sessionPubKey: upper },
          d,
        )
      ).kind,
    ).toBe('serve-paid');
  });

  // Property: a 402 offer for an LPA route and a non-LPA route differ (sessionKeyRequired is in extra), so an
  // offer captured on /esim/topup cannot be replayed against /esim/provision.
  it('a top-up offer echoed on an LPA route → requirements_mismatch', async () => {
    const d = { ...deps(), payments: new MockPaymentRail({ now: deps().now }) };
    const payment = paymentPayload(evmOffer(d, 100, false), {
      nonce: sessionNonce(SPK, keccak256),
    });
    expect(
      await decide({ resource, mb: 100, payment, requireSessionKey: true, sessionPubKey: SPK }, d),
    ).toMatchObject({ detail: 'requirements_mismatch' });
  });
});
