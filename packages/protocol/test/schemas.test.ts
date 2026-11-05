import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { DELETE, example, examples, mutate, variants } from './helpers.js';
import liveSupported from '../../../fixtures/facilitator/x402org/live-supported.json' with { type: 'json' };
import * as schemas from '../src/schemas/index.js';

const exported = Object.entries(schemas as Record<string, unknown>).filter(
  (entry): entry is [string, z.ZodType] =>
    entry[0].endsWith('Schema') && entry[1] instanceof z.ZodType,
);
const byName = new Map(exported);
const schema = (name: string): z.ZodType => {
  const s = byName.get(name);
  if (!s) throw new Error(`no exported schema ${name}`);
  return s;
};

const H32 = `0x${'ab'.repeat(32)}`;

describe('every exported schema accepts its fixture example', () => {
  it('has an example for every exported schema', () => {
    expect(exported.map(([name]) => name).filter((name) => !(name in examples))).toEqual([]);
  });

  it.each(exported)('%s', (name, s) => {
    const result = s.safeParse(examples[name]);
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it.each([
    ['paymentRequiredSchema', 'paymentRequired.hedera'],
    ['paymentPayloadSchema', 'paymentPayload.hedera'],
    ['personhoodProofSchema', 'personhoodProof.v3'],
    ['settleResultSchema', 'settle.hedera'],
    ['settleResultSchema', 'settle.pending'],
  ])('%s accepts variant %s', (name, variant) => {
    expect(schema(name).safeParse(variants[variant]).success).toBe(true);
  });
});

/** One mutation per field class: hex, bytes32, address, hedera account, digits, CAIP-2, ms, MB, enum, literal, missing, type. */
const mutations: [schema: string, path: string, bad: unknown][] = [
  ['sealedBoxSchema', 'epk', '0x1234'],
  ['sealedBoxSchema', 'nonce', H32],
  ['sealedBoxSchema', 'ct', 'c7c7'],
  ['sealedBoxSchema', 'v', 2],
  ['entitlementSchema', 'key', 'short'],
  ['entitlementSchema', 'kind', 'stolen'],
  ['entitlementSchema', 'status', 'done'],
  ['entitlementSchema', 'tier', 'gold'],
  ['entitlementSchema', 'mbTotal', 1_000_001],
  ['entitlementSchema', 'mbUsed', 1.5],
  ['entitlementSchema', 'usageAsOf', -1],
  ['entitlementSchema', 'iccidHash', '0x1c'],
  ['entitlementSchema', 'network', 'base-sepolia'],
  ['entitlementSchema', 'createdAt', DELETE],
  ['campaignSchema', 'sponsor', '0x1234'],
  ['campaignSchema', 'name', 'emoji \u{1F600}'],
  ['campaignSchema', 'name', 'line\nbreak'],
  ['campaignSchema', 'bundleMb.orb', 301],
  ['campaignSchema', 'bundleMb.device', 100],
  ['campaignSchema', 'pricePerClaimUsd6', '0.25'],
  ['campaignSchema', 'pricePerClaimUsd6', 250000],
  ['campaignSchema', 'maxClaims', 0],
  ['campaignSchema', 'validityDays', 31],
  ['giftSchema', 'serial', '9A9A9A9A'],
  ['giftSchema', 'to', 'alice.eth'],
  ['giftSchema', 'state', 'expired'],
  ['giftSchema', 'fundedBy', 'gift'],
  ['giftSchema', 'pinKey', DELETE],
  ['giftSchema', 'message', 'x'.repeat(81)],
  ['nonceSchema', 'audience', 'x'.repeat(33)],
  ['receiptSchema', 'kind', 'refund'],
  ['receiptSchema', 'entitlementKeyHash', 'ent:v1:0x01'],
  ['receiptSchema', 'hcs.sequence', -1],
  ['topUpPolicySchema', 'stepMb', 150],
  ['topUpPolicySchema', 'stepMb', 400],
  ['topUpPolicySchema', 'expiryLeadS', 59],
  ['topUpPolicySchema', 'paused', 'no'],
  ['agentPolicySchema', 'owner', '0.0.1234'],
  ['paymentResourceSchema', 'url', 'not a url'],
  ['paymentResourceSchema', 'description', DELETE],
  ['paymentRequirementsSchema', 'scheme', 'upto'],
  ['paymentRequirementsSchema', 'amount', '1e6'],
  ['paymentRequirementsSchema', 'network', 'eip155'],
  ['paymentRequirementsSchema', 'maxTimeoutSeconds', 0],
  ['paymentRequirementsSchema', 'maxTimeoutSeconds', 3601],
  ['paymentRequiredSchema', 'x402Version', 1],
  ['paymentRequiredSchema', 'accepts', []],
  ['paymentAuthorizationSchema', 'nonce', '0x01'],
  ['paymentAuthorizationSchema', 'value', '-1'],
  ['paymentAuthorizationSchema', 'validBefore', 1793707500],
  ['hederaExactPayloadSchema', 'transaction', 'not base64!'],
  ['hederaExactPayloadSchema', 'transaction', 'A'.repeat(8_196)],
  ['verifyResultSchema', 'isValid', 'true'],
  ['settleResultSchema', 'transaction', '0x1'],
  ['personhoodProofSchema', 'protocol_version', '2.0'],
  ['personhoodProofSchema', 'responses', []],
  ['personhoodProofSchema', 'responses.0.nullifier', '0xabc'],
  ['personhoodProofSchema', 'responses.0.proof', ['0x11']],
  ['personhoodProofSchema', 'responses.0.signal_hash', DELETE],
  ['rpContextSchema', 'rp_id', 'xx_123'],
  ['rpContextSchema', 'environment', 'sandbox'],
  ['rpContextSchema', 'created_at', 0],
  ['challengeRequestSchema', 'audience', 'other'],
  ['challengeRequestSchema', 'path', '/admin'],
  ['challengeSchema', 'signal', DELETE],
  ['claimRequestSchema', 'campaignId', 'camp:1'],
  ['entitledResponseSchema', 'receipt', DELETE],
  ['topUpResponseSchema', 'settlement', DELETE],
  ['provisionQuerySchema', 'mb', 'lots'],
  ['topUpQuerySchema', 'key', 'k'],
  ['giftRequestSchema', 'mb', 150],
  ['giftRequestSchema', 'mb', 3100],
  ['giftRequestSchema', 'name', 'ab'],
  ['giftResponseSchema', 'pin', '1234'],
  ['giftReclaimRequestSchema', 'payer', '0.0.1'],
  ['giftReclaimResponseSchema', 'refundedUsd6', '2.00'],
  ['cardPreviewSchema', 'state', 'void'],
  ['cardRedeemRequestSchema', 'pin', '482199301127506a'],
  ['meResponseSchema', 'cached', 'false'],
  ['meResponseSchema', 'usageSource', 'guess'],
  ['plansResponseSchema', 'mode', 'demo'],
  ['plansResponseSchema', 'paid.stepMb', 200],
  ['sponsorRegisterSchema', 'auth.signature', 'sig'],
  ['sponsorViewSchema', 'chain.budgetUsd6', 125],
  ['agentPolicyPutSchema', 'issuedAt', -5],
  ['agentPolicyViewSchema', 'spentTodayUsd6', DELETE],
  ['errorBodySchema', 'error', 42],
  ['healthSchema', 'mode', 'prod'],
  ['usageEventSchema', 'iccid', '89910000'],
  ['usageEventSchema', 'provider', 'airalo'],
  ['mockWebhookEnvelopeSchema', 'events', {}],
  ['hcsMessageSchema', 't', 'refund'],
  ['hcsMessageSchema', 'at', '3 Nov 2026'],
  ['hcsMessageSchema', 'reason', 'whim'],
];

describe('rejects one mutation per field class', () => {
  it.each(mutations)('%s: %s', (name, path, bad) => {
    expect(schema(name).safeParse(mutate(examples[name], path, bad)).success).toBe(false);
  });
});

describe('x402 requirement rules', () => {
  const evm = example('paymentRequirementsSchema');
  const hedera = (example<{ accepts: unknown[] }>('paymentRequired.hedera').accepts[0] ??
    {}) as Record<string, unknown>;
  const parse = (value: unknown): boolean =>
    schemas.paymentRequirementsSchema.safeParse(value).success;

  it('payTo must match the network namespace', () => {
    expect(parse({ ...evm, payTo: '0.0.5001234' })).toBe(false);
    expect(parse({ ...hedera, payTo: evm.payTo })).toBe(false);
    expect(parse({ ...evm, network: 'solana:devnet' })).toBe(false);
    expect(schemas.payToMatchesNetwork('hedera:testnet', '0.0.1')).toBe(true);
  });

  it('EVM needs the EIP-712 domain in extra (A-21)', () => {
    expect(parse({ ...evm, extra: undefined })).toBe(false);
    expect(parse({ ...evm, extra: { name: 'USDC' } })).toBe(false);
    expect(parse({ ...evm, extra: { name: 'USDC', version: 2 } })).toBe(false);
  });

  it('Hedera needs extra.feePayer and maxTimeoutSeconds ≤ 180 (A-20)', () => {
    expect(parse(hedera)).toBe(true);
    expect(parse({ ...hedera, extra: {} })).toBe(false);
    expect(
      parse({ ...hedera, extra: { feePayer: '0x0000000000000000000000000000000000000001' } }),
    ).toBe(false);
    expect(parse({ ...hedera, maxTimeoutSeconds: 181 })).toBe(false);
  });

  it('a Hedera accept whose feePayer is not a string in 0.0.x form is refused whatever else extra carries [RT-A-16]', () => {
    const { amount: _amount, ...template } = hedera;
    const accept = (extra: Record<string, unknown>): boolean =>
      schemas.acceptTemplateSchema.safeParse({ ...template, extra }).success;
    expect(accept({ feePayer: '0.0.9185802', features: { smartWalletSupported: true } })).toBe(
      true,
    );
    for (const feePayer of [123, true, null, ['0.0.9185802'], { id: '0.0.9185802' }, '9185802'])
      expect(accept({ feePayer })).toBe(false);
    expect(parse({ ...hedera, extra: { feePayer: 123 } })).toBe(false);
  });

  it('accept templates follow the same rules without an amount', () => {
    const { amount: _amount, ...template } = evm;
    expect(schemas.acceptTemplateSchema.safeParse(template).success).toBe(true);
    expect(schemas.acceptTemplateSchema.safeParse({ ...template, payTo: '0.0.1' }).success).toBe(
      false,
    );
  });

  it('the payload kind must match accepted.network', () => {
    const evmPayload = example('paymentPayloadSchema');
    const hederaPayload = example('paymentPayload.hedera');
    expect(
      schemas.paymentPayloadSchema.safeParse({ ...evmPayload, payload: hederaPayload.payload })
        .success,
    ).toBe(false);
    expect(
      schemas.paymentPayloadSchema.safeParse({ ...hederaPayload, payload: evmPayload.payload })
        .success,
    ).toBe(false);
  });

  it('isEvmExact discriminates the union', () => {
    expect(
      schemas.isEvmExact(example<schemas.PaymentPayload>('paymentPayloadSchema').payload),
    ).toBe(true);
    expect(
      schemas.isEvmExact(example<schemas.PaymentPayload>('paymentPayload.hedera').payload),
    ).toBe(false);
  });
});

describe('facilitator /supported (RT-A-16, T-42)', () => {
  const body: unknown = liveSupported.exchanges[0]?.response.body;

  it('the x402.org recording parses: v1 kinds under legacy names and non-string extra values survive [RT-A-16]', () => {
    const parsed = schemas.supportedResponseSchema.parse(body);
    expect(parsed.kinds).toHaveLength(11);
    // two version-1 kinds under legacy names that are not CAIP-2: listed, parsed, never selected
    const legacy = parsed.kinds.filter((k) => k.x402Version === 1);
    expect(legacy).toHaveLength(2);
    for (const k of legacy)
      expect(schemas.caipNetworkSchema.safeParse(k.network).success).toBe(false);
    expect(parsed.kinds.find((k) => k.network === 'hedera:testnet')?.extra).toEqual({
      feePayer: '0.0.9185802',
    });
    expect(parsed.kinds.find((k) => k.network.startsWith('solana:'))?.extra).toMatchObject({
      transactionVersions: [0, 1],
      features: { smartWalletSupported: true },
    });
    expect(parsed.signers?.['hedera:*']).toEqual(['0.0.9185802']);
  });

  it('a kind is still a bounded shape: no version, an empty network or an oversized list is refused', () => {
    const kind = { x402Version: 2, scheme: 'exact', network: 'eip155:84532' };
    const ok = (kinds: unknown[]): boolean =>
      schemas.supportedResponseSchema.safeParse({ kinds }).success;
    expect(ok([kind])).toBe(true);
    expect(ok([{ ...kind, x402Version: '2' }])).toBe(false);
    expect(ok([{ ...kind, x402Version: 0 }])).toBe(false);
    expect(ok([{ ...kind, network: '' }])).toBe(false);
    expect(ok([{ ...kind, network: 'x'.repeat(65) }])).toBe(false);
    expect(ok([{ ...kind, extra: 'feePayer=0.0.1' }])).toBe(false);
    expect(ok(Array.from({ length: 65 }, () => kind))).toBe(false);
  });
});

describe('other refinements', () => {
  it('entitlement: mbUsed must not exceed mbTotal', () => {
    const e = example('entitlementSchema');
    expect(schemas.entitlementSchema.safeParse({ ...e, mbUsed: 301 }).success).toBe(false);
    expect(schemas.entitlementSchema.safeParse({ ...e, mbUsed: 300 }).success).toBe(true);
  });

  it('personhood: session results are rejected; unknown fields survive (forwarded unchanged)', () => {
    const proof = example('personhoodProofSchema');
    expect(
      schemas.personhoodProofSchema.safeParse({ ...proof, session_id: 'session_1' }).success,
    ).toBe(false);
    const extended = { ...proof, integrity_bundle: { version: 1 } };
    expect(schemas.personhoodProofSchema.parse(extended)).toEqual(extended);
  });

  it('identifier → level is the one mapping; unknown identifiers have no level', () => {
    expect(schemas.verificationLevelFromIdentifier('proof_of_human')).toBe('orb');
    expect(schemas.verificationLevelFromIdentifier('passport')).toBe('secure_document');
    expect(schemas.verificationLevelFromIdentifier('selfie')).toBe('device');
    expect(schemas.verificationLevelFromIdentifier('retina')).toBeUndefined();
    expect(schemas.verificationLevelFromIdentifier('toString')).toBeUndefined();
    for (const level of Object.values(schemas.IDENTIFIER_LEVEL)) {
      expect(schemas.verificationLevelSchema.options).toContain(level);
    }
  });

  it.each([
    ['LPA:1$smdp.example.com$ABCD-1234', true],
    ['LPA:1$rsp.truphone.com$QR-G-5C-1LS-1W1Z9P7$', true],
    ['LPA:1$smdp.io$MATCH$1.3.6.1.4.1.31746$1', true],
    ['LPA:1$smdp.io$MATCH$$1', true],
    ['LPA:2$smdp.io$MATCH', false],
    ['LPA:1$smdp.io', false],
    ['LPA:1$smdp.io$MATCH$oid$2', false],
    ['LPA:1$smdp.io$MA TCH', false],
    ['lpa:1$smdp.io$MATCH', false],
  ])('lpaSchema %s → %s', (lpa, ok) => {
    expect(schemas.lpaSchema.safeParse(lpa).success).toBe(ok);
  });

  it('safeText allows printable ASCII and Devanagari only', () => {
    const s = schemas.safeTextSchema(20);
    expect(s.safeParse('Hello, दुनिया').success).toBe(true);
    for (const bad of ['', 'tab\there', '<‮>', 'x'.repeat(21), 'zero​width']) {
      expect(s.safeParse(bad).success).toBe(false);
    }
  });

  it('receiptPublic drops the private key and key hash', () => {
    const r = schemas.receiptPublicSchema.parse(example('receiptSchema'));
    expect(r).not.toHaveProperty('key');
    expect(r).not.toHaveProperty('entitlementKeyHash');
  });

  it('caip-2 accepts the namespaces we use and rejects plain names', () => {
    for (const ok of ['eip155:31337', 'hedera:testnet', 'eip155:84532']) {
      expect(schemas.caipNetworkSchema.safeParse(ok).success).toBe(true);
    }
    for (const bad of ['base-sepolia', 'EIP155:1', 'eip155:', ':1']) {
      expect(schemas.caipNetworkSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('webhookCanonical is `${timestamp}.${rawBody}`', () => {
    expect(schemas.webhookCanonical(1793707200, '{}')).toBe('1793707200.{}');
    expect(Object.values(schemas.MOCK_WEBHOOK_HEADERS).every((h) => h === h.toLowerCase())).toBe(
      true,
    );
  });
});
