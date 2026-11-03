/**
 * Authors the `"source": "docs"` fixtures that must stay consistent with this package's builders (fixtureProof,
 * the contract-suite proofs, viem's ENS encoding). Run: `pnpm --filter @ethglobal/adapters exec tsx scripts/author-fixtures.ts`.
 * Humans overwrite these on Wednesday with `scripts/record-fixture.ts` recordings (`"source": "live"`); see README.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { hashToField } from '@ethglobal/crypto';
import { WORLD_ACTION } from '@ethglobal/protocol/ids';
import { computeRpSignatureMessage } from '@worldcoin/idkit-core/signing';
import { bytesToHex, hexToBytes, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { domainFromRequirements, fromPaymentAuthorization, typedDataTransferWithAuthorization } from '@ethglobal/eip3009';
import { USDC_ASSET, USDC_EIP712_DOMAIN } from '@ethglobal/protocol/ids';

import { buildPaymentRequired } from '../src/payment-requirements.js';
import { fixturePath } from '../src/testing/fixtures.js';
import {
  anvilAccounts,
  anvilKeys,
  anvilRoles,
  fixtureProof,
  paymentPayload,
  requirementInput,
  suiteProofs,
  SUITE_SIGNAL,
  T0,
} from '../src/testing/index.js';

import type { PersonhoodProof } from '../src/types.js';

const RECORDED_AT = '2026-11-03T12:00:00Z';
const VERIFY_URL = 'https://developer.world.org/api/v4/verify/rp_recharge0test';

function write(rel: string, body: unknown): void {
  const path = fixturePath(rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
}

const recording = (name: string, note: string, exchanges: unknown[]) => ({
  name,
  recordedAt: RECORDED_AT,
  source: 'docs',
  note,
  exchanges,
});

// ── World ID v4 verify (API-FACTS §4.4) ────────────────────────────────────────────────────────────────────
const WORLD_NOTE =
  '[verify Wed] authored from developer-docs@b07e972 openapi/developer-portal.json (POST /api/v4/verify/{rp_id}); request body = the IDKit result unchanged. Re-record with a real IDKit 4 proof for WORLD_RP_ID.';

const first = (p: PersonhoodProof) => p.responses[0]!;
function ok(proof: PersonhoodProof, over: Record<string, unknown> = {}, results?: unknown[]) {
  return {
    status: 200,
    body: {
      success: true,
      action: proof.action,
      nullifier: first(proof).nullifier,
      created_at: '2026-11-03T12:00:01.000Z',
      environment: (proof as { environment?: string }).environment ?? 'production',
      results: results ?? proof.responses.map((r) => ({ identifier: r.identifier, success: true })),
      ...over,
    },
  };
}
const refused = (code: string, results?: unknown[]) => ({
  status: 400,
  body: { success: false, code, detail: `${code} (authored from the docs)`, ...(results ? { results } : {}) },
});
const exchange = (proof: PersonhoodProof, response: unknown) => ({
  request: { method: 'POST', url: VERIFY_URL, body: proof },
  response,
});

const SIG: Hex = SUITE_SIGNAL;
const orb = fixtureProof('orb', SIG, 'world-ok-v4');
const v3 = fixtureProof('device', SIG, 'world-ok-v3');
const world: Record<string, unknown[]> = {
  'verify-ok-v4': [exchange(orb, ok(orb))],
  'verify-ok-v3-legacy': [exchange(v3, ok(v3))],
  'verify-device-wins': [exchange(orb, ok(orb, {}, [{ identifier: 'device', success: true }]))],
  'verify-replayed': [exchange(orb, refused('nullifier_replayed'))],
  'verify-max-verifications': [exchange(orb, refused('max_verifications_reached'))],
  'verify-all-failed': [
    exchange(orb, refused('all_verifications_failed', [{ identifier: 'proof_of_human', success: false, code: 'verification_error', detail: 'invalid proof' }])),
  ],
  'verify-invalid-proof': [exchange(orb, refused('invalid_proof'))],
  'verify-app-not-migrated': [exchange(orb, refused('app_not_migrated'))],
  'verify-malformed': [exchange(orb, { status: 200, body: { ok: true } })],
  'verify-staging': [exchange(orb, ok(orb, { environment: 'staging' }))],
  'verify-other-action': [exchange(orb, ok(orb, { action: 'some-other-action' }))],
  'verify-partial': [
    exchange(orb, ok(orb, {}, [{ identifier: 'proof_of_human', success: true }, { identifier: 'passport', success: false }])),
  ],
  'verify-session': [exchange(orb, ok(orb, { session_id: 'session_' + 'ab'.repeat(64) }))],
  'verify-nullifier-mismatch': [exchange(orb, ok(orb, { nullifier: '12345' }))],
  'verify-nullifier-overflow': [exchange(orb, ok(orb, { nullifier: (1n << 256n).toString() }))],
  'verify-transport-errors': [
    exchange(orb, { status: 404, body: { code: 'not_found' } }),
    exchange(orb, { status: 429, body: { code: 'rate_limited' } }),
    exchange(orb, { status: 503, body: 'upstream down' }),
  ],
  'contract-suite': [
    exchange(suiteProofs.orb, ok(suiteProofs.orb)),
    exchange(suiteProofs.orb, refused('nullifier_replayed')),
    exchange(suiteProofs.document, ok(suiteProofs.document)),
    exchange(suiteProofs.device, ok(suiteProofs.device)),
    exchange(suiteProofs.staging, ok(suiteProofs.staging, { environment: 'staging' })),
  ],
};
for (const [name, exchanges] of Object.entries(world)) write(`world/${name}.json`, recording(`world ${name}`, WORLD_NOTE, exchanges));

write('world/hash-to-field-vectors.json', {
  name: 'World ID hash_to_field vectors',
  recordedAt: RECORDED_AT,
  source: 'docs',
  note: 'API-FACTS §4.2 (developer-docs world-id/idkit/signatures.mdx): keccak256(utf8) >> 8',
  vectors: [
    { input: '', output: '0x00c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a4' },
    { input: 'test_signal', output: '0x00c1636e0a961a3045054c4d61374422c31a95846b8442f0927ad2ff1d6112ed' },
    { input: 'hello', output: '0x001c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36dea' },
  ],
});

// rp_context: a fixed public TEST key, a fixed entropy, T0; message from idkit-core's computeRpSignatureMessage.
const RP_TEST_KEY: Hex = '0x1111111111111111111111111111111111111111111111111111111111111111';
const entropy = new Uint8Array(32).fill(0x22);
const nonce = hashToField(entropy);
const createdAt = Math.floor(T0 / 1000);
const message = computeRpSignatureMessage(hexToBytes(nonce), createdAt, createdAt + 300, WORLD_ACTION);
const account = privateKeyToAccount(RP_TEST_KEY);
write('world/rp-context-vector.json', {
  name: 'IDKit 4 rp_context signature vector',
  recordedAt: RECORDED_AT,
  source: 'docs',
  note: 'msg = 0x01 ‖ nonce ‖ created_at u64 BE ‖ expires_at u64 BE ‖ hash_to_field(action); EIP-191 (API-FACTS §4.2). Public test key — never a real WORLD_RP_SIGNING_KEY.',
  signingKeyHex: RP_TEST_KEY,
  signer: account.address,
  entropy: bytesToHex(entropy),
  action: WORLD_ACTION,
  nonce,
  created_at: createdAt,
  expires_at: createdAt + 300,
  message: bytesToHex(message),
  signature: await account.signMessage({ message: { raw: message } }),
});

// ── x402 facilitators (API-FACTS §1.5–1.7, x402@0e6e8c5) ─────────────────────────────────────────────────
const X402_NOTE =
  '[verify Wed] authored from the x402 v2 spec @ 0e6e8c5 §5–7 and @x402/core 2.29.0 types; re-record against https://x402.org/facilitator (curl /supported first).';
const HEDERA_NOTE =
  '[verify Wed] authored from @x402/hedera 2.29.0 (scheme_exact_hedera.md, facilitator returns transaction = 0.0.x@s.n) and hedera-docs facilitators.mdx (Blocky402 fee payer 0.0.7162784); re-record at the Wed 14:00 pre-deploy.';
const X402 = 'https://x402.org/facilitator';
const BLOCKY = 'https://api.testnet.blocky402.com';
const human = privateKeyToAccount(anvilKeys[anvilRoles.human]);
const evmReq = buildPaymentRequired(
  requirementInput({
    network: 'eip155:84532',
    asset: USDC_ASSET['eip155:84532'],
    payTo: anvilAccounts[anvilRoles.payout],
    extra: { ...USDC_EIP712_DOMAIN['eip155:84532'] },
  }),
).accepts[0]!;
const draft = paymentPayload(evmReq, { nonce: `0x${'f3'.repeat(32)}` });
if (!('authorization' in draft.payload)) throw new Error('evm payload');
const evmPayload = {
  ...draft,
  payload: {
    ...draft.payload,
    signature: await human.signTypedData(
      typedDataTransferWithAuthorization(domainFromRequirements(evmReq), fromPaymentAuthorization(draft.payload.authorization)),
    ),
  },
};
const hederaReq = buildPaymentRequired(
  requirementInput({
    network: 'hedera:testnet',
    asset: USDC_ASSET['hedera:testnet'],
    payTo: '0.0.5005',
    maxTimeoutSeconds: 180,
    extra: { feePayer: '0.0.7162784' },
  }),
).accepts[0]!;
const hederaPayload = {
  x402Version: 2,
  accepted: hederaReq,
  payload: { transaction: Buffer.from('authored placeholder: a partially signed TransferTransaction').toString('base64') },
};
const evmBody = { x402Version: 2, paymentPayload: evmPayload, paymentRequirements: evmReq };
const hederaBody = { x402Version: 2, paymentPayload: hederaPayload, paymentRequirements: hederaReq };
const EVM_TX = `0x${'9e'.repeat(32)}`;
const HEDERA_TX = '0.0.7162784@1793707200.123456789';
const payer = human.address;
const kinds = (feePayer: string, evm = true) => [
  ...(evm ? [{ x402Version: 2, scheme: 'exact', network: 'eip155:84532' }] : []),
  { x402Version: 2, scheme: 'exact', network: 'hedera:testnet', extra: { feePayer } },
];
const get = (url: string, body: unknown, status = 200) => ({ request: { method: 'GET', url }, response: { status, body } });
const post = (url: string, reqBody: unknown, body: unknown, status = 200) => ({
  request: { method: 'POST', url, body: reqBody },
  response: { status, body },
});
const supported = (base: string, feePayer: string, evm = true) =>
  get(`${base}/supported`, { kinds: kinds(feePayer, evm), extensions: [], signers: { 'eip155:*': [anvilAccounts[anvilRoles.relayer]] } });
const x402: Record<string, unknown[]> = {
  supported: [supported(X402, '0.0.9185802')],
  'supported-other-fee-payer': [supported(X402, '0.0.6666666')],
  'supported-evm-only': [get(`${X402}/supported`, { kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:84532' }], extensions: [] })],
  'verify-ok': [supported(X402, '0.0.9185802'), post(`${X402}/verify`, evmBody, { isValid: true, payer })],
  'verify-invalid': [
    supported(X402, '0.0.9185802'),
    post(`${X402}/verify`, evmBody, { isValid: false, invalidReason: 'invalid_exact_evm_payload_signature', payer }, 400),
  ],
  'settle-ok': [supported(X402, '0.0.9185802'), post(`${X402}/settle`, evmBody, { success: true, transaction: EVM_TX, network: 'eip155:84532', payer })],
  'settle-nonce-used': [
    supported(X402, '0.0.9185802'),
    post(`${X402}/settle`, evmBody, { success: false, errorReason: 'invalid_transaction_state', transaction: '', network: 'eip155:84532', payer }, 400),
  ],
  'settle-no-tx': [supported(X402, '0.0.9185802'), post(`${X402}/settle`, evmBody, { success: true, transaction: 'trust-me-it-settled', network: 'eip155:84532', payer })],
  'settle-foreign-network': [supported(X402, '0.0.9185802'), post(`${X402}/settle`, evmBody, { success: true, transaction: EVM_TX, network: 'eip155:8453', payer })],
  'settle-malformed': [supported(X402, '0.0.9185802'), post(`${X402}/settle`, evmBody, { ok: true })],
  'settle-pending': [
    supported(X402, '0.0.9185802'),
    post(`${X402}/settle`, evmBody, { success: false, errorReason: 'settlement_pending', transaction: EVM_TX, network: 'eip155:84532', payer }),
  ],
};
for (const [name, exchanges] of Object.entries(x402)) write(`facilitator/x402org/${name}.json`, recording(`x402.org ${name}`, X402_NOTE, exchanges));
const mirror = 'https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.7162784-1793707200-123456789';
const hedera: Record<string, unknown[]> = {
  supported: [supported(BLOCKY, '0.0.7162784', false)],
  'verify-ok': [supported(BLOCKY, '0.0.7162784', false), post(`${BLOCKY}/verify`, hederaBody, { isValid: true, payer: '0.0.6006' })],
  'settle-ok': [supported(BLOCKY, '0.0.7162784', false), post(`${BLOCKY}/settle`, hederaBody, { success: true, transaction: HEDERA_TX, network: 'hedera:testnet', payer: '0.0.6006' })],
  'settle-transaction-id': [
    supported(BLOCKY, '0.0.7162784', false),
    post(`${BLOCKY}/settle`, hederaBody, { success: true, transactionId: HEDERA_TX, network: 'hedera:testnet', payer: '0.0.6006' }),
  ],
  'settle-evm-hash': [supported(BLOCKY, '0.0.7162784', false), post(`${BLOCKY}/settle`, hederaBody, { success: true, transaction: EVM_TX, network: 'hedera:testnet', payer: '0.0.6006' })],
  'settle-pending': [
    supported(BLOCKY, '0.0.7162784', false),
    post(`${BLOCKY}/settle`, hederaBody, { success: false, errorReason: 'settlement_pending', transaction: HEDERA_TX, network: 'hedera:testnet', payer: '0.0.6006' }),
    get(mirror, { transactions: [] }),
    get(mirror, { transactions: [{ result: 'SUCCESS', transaction_id: '0.0.7162784-1793707200-123456789', consensus_timestamp: '1793707201.000000001' }] }),
  ],
};
for (const [name, exchanges] of Object.entries(hedera)) write(`facilitator/hedera/${name}.json`, recording(`hedera facilitator ${name}`, HEDERA_NOTE, exchanges));

console.log('fixtures authored');
