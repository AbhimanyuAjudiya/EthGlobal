/**
 * Authors the `"source": "docs"` fixtures that must stay consistent with this package's builders (fixtureProof,
 * the contract-suite proofs, viem's ENS encoding). Run: `pnpm --filter @ethglobal/adapters exec tsx scripts/author-fixtures.ts`.
 * Humans overwrite these on Wednesday with `scripts/record-fixture.ts` recordings (`"source": "live"`); see README.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { computeRpSignatureMessage } from '@worldcoin/idkit-core/signing';
import {
  bytesToHex,
  createPublicClient,
  decodeFunctionData,
  encodeAbiParameters,
  hexToBytes,
  http,
  namehash,
  parseAbi,
  zeroAddress,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';

import { hashToField, sha256Hex } from '@ethglobal/crypto';
import {
  domainFromRequirements,
  fromPaymentAuthorization,
  typedDataTransferWithAuthorization,
} from '@ethglobal/eip3009';
import { WORLD_ACTION, USDC_ASSET, USDC_EIP712_DOMAIN } from '@ethglobal/protocol/ids';

import { EnsResolver } from '../src/live/ens-resolver.js';
import { buildPaymentRequired } from '../src/payment-requirements.js';
import { fixturePath } from '../src/testing/fixtures.js';
import {
  anvilAccounts,
  anvilKeys,
  anvilRoles,
  fixtureProof,
  NAME_FIXTURE,
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
  body: {
    success: false,
    code,
    detail: `${code} (authored from the docs)`,
    ...(results ? { results } : {}),
  },
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
    exchange(
      orb,
      refused('all_verifications_failed', [
        {
          identifier: 'proof_of_human',
          success: false,
          code: 'verification_error',
          detail: 'invalid proof',
        },
      ]),
    ),
  ],
  'verify-invalid-proof': [exchange(orb, refused('invalid_proof'))],
  'verify-app-not-migrated': [exchange(orb, refused('app_not_migrated'))],
  'verify-malformed': [exchange(orb, { status: 200, body: { ok: true } })],
  'verify-staging': [exchange(orb, ok(orb, { environment: 'staging' }))],
  'verify-other-action': [exchange(orb, ok(orb, { action: 'some-other-action' }))],
  'verify-partial': [
    exchange(
      orb,
      ok(orb, {}, [
        { identifier: 'proof_of_human', success: true },
        { identifier: 'passport', success: false },
      ]),
    ),
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
for (const [name, exchanges] of Object.entries(world))
  write(`world/${name}.json`, recording(`world ${name}`, WORLD_NOTE, exchanges));

write('world/hash-to-field-vectors.json', {
  name: 'World ID hash_to_field vectors',
  recordedAt: RECORDED_AT,
  source: 'docs',
  note: 'API-FACTS §4.2 (developer-docs world-id/idkit/signatures.mdx): keccak256(utf8) >> 8',
  vectors: [
    { input: '', output: '0x00c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a4' },
    {
      input: 'test_signal',
      output: '0x00c1636e0a961a3045054c4d61374422c31a95846b8442f0927ad2ff1d6112ed',
    },
    {
      input: 'hello',
      output: '0x001c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36dea',
    },
  ],
});

// rp_context: a fixed public TEST key, a fixed entropy, T0; message from idkit-core's computeRpSignatureMessage.
const RP_TEST_KEY: Hex = '0x1111111111111111111111111111111111111111111111111111111111111111';
const entropy = new Uint8Array(32).fill(0x22);
const nonce = hashToField(entropy);
const createdAt = Math.floor(T0 / 1000);
const message = computeRpSignatureMessage(
  hexToBytes(nonce),
  createdAt,
  createdAt + 300,
  WORLD_ACTION,
);
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
      typedDataTransferWithAuthorization(
        domainFromRequirements(evmReq),
        fromPaymentAuthorization(draft.payload.authorization),
      ),
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
  payload: {
    transaction: Buffer.from(
      'authored placeholder: a partially signed TransferTransaction',
    ).toString('base64'),
  },
};
const evmBody = { x402Version: 2, paymentPayload: evmPayload, paymentRequirements: evmReq };
const hederaBody = {
  x402Version: 2,
  paymentPayload: hederaPayload,
  paymentRequirements: hederaReq,
};
const EVM_TX = `0x${'9e'.repeat(32)}`;
const HEDERA_TX = '0.0.7162784@1793707200.123456789';
const payer = human.address;
const kinds = (feePayer: string, evm = true) => [
  ...(evm ? [{ x402Version: 2, scheme: 'exact', network: 'eip155:84532' }] : []),
  { x402Version: 2, scheme: 'exact', network: 'hedera:testnet', extra: { feePayer } },
];
const get = (url: string, body: unknown, status = 200) => ({
  request: { method: 'GET', url },
  response: { status, body },
});
const post = (url: string, reqBody: unknown, body: unknown, status = 200) => ({
  request: { method: 'POST', url, body: reqBody },
  response: { status, body },
});
const supported = (base: string, feePayer: string, evm = true) =>
  get(`${base}/supported`, {
    kinds: kinds(feePayer, evm),
    extensions: [],
    signers: { 'eip155:*': [anvilAccounts[anvilRoles.relayer]] },
  });
const x402: Record<string, unknown[]> = {
  supported: [supported(X402, '0.0.9185802')],
  'supported-other-fee-payer': [supported(X402, '0.0.6666666')],
  'supported-evm-only': [
    get(`${X402}/supported`, {
      kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:84532' }],
      extensions: [],
    }),
  ],
  'verify-ok': [
    supported(X402, '0.0.9185802'),
    post(`${X402}/verify`, evmBody, { isValid: true, payer }),
  ],
  'verify-invalid': [
    supported(X402, '0.0.9185802'),
    post(
      `${X402}/verify`,
      evmBody,
      { isValid: false, invalidReason: 'invalid_exact_evm_payload_signature', payer },
      400,
    ),
  ],
  'settle-ok': [
    supported(X402, '0.0.9185802'),
    post(`${X402}/settle`, evmBody, {
      success: true,
      transaction: EVM_TX,
      network: 'eip155:84532',
      payer,
    }),
  ],
  'settle-nonce-used': [
    supported(X402, '0.0.9185802'),
    post(
      `${X402}/settle`,
      evmBody,
      {
        success: false,
        errorReason: 'invalid_transaction_state',
        transaction: '',
        network: 'eip155:84532',
        payer,
      },
      400,
    ),
  ],
  'settle-no-tx': [
    supported(X402, '0.0.9185802'),
    post(`${X402}/settle`, evmBody, {
      success: true,
      transaction: 'trust-me-it-settled',
      network: 'eip155:84532',
      payer,
    }),
  ],
  'settle-foreign-network': [
    supported(X402, '0.0.9185802'),
    post(`${X402}/settle`, evmBody, {
      success: true,
      transaction: EVM_TX,
      network: 'eip155:8453',
      payer,
    }),
  ],
  'settle-malformed': [
    supported(X402, '0.0.9185802'),
    post(`${X402}/settle`, evmBody, { ok: true }),
  ],
  'settle-pending': [
    supported(X402, '0.0.9185802'),
    post(`${X402}/settle`, evmBody, {
      success: false,
      errorReason: 'settlement_pending',
      transaction: EVM_TX,
      network: 'eip155:84532',
      payer,
    }),
  ],
};
for (const [name, exchanges] of Object.entries(x402))
  write(`facilitator/x402org/${name}.json`, recording(`x402.org ${name}`, X402_NOTE, exchanges));
const mirror =
  'https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.7162784-1793707200-123456789';
const hedera: Record<string, unknown[]> = {
  supported: [supported(BLOCKY, '0.0.7162784', false)],
  'verify-ok': [
    supported(BLOCKY, '0.0.7162784', false),
    post(`${BLOCKY}/verify`, hederaBody, { isValid: true, payer: '0.0.6006' }),
  ],
  'settle-ok': [
    supported(BLOCKY, '0.0.7162784', false),
    post(`${BLOCKY}/settle`, hederaBody, {
      success: true,
      transaction: HEDERA_TX,
      network: 'hedera:testnet',
      payer: '0.0.6006',
    }),
  ],
  'settle-transaction-id': [
    supported(BLOCKY, '0.0.7162784', false),
    post(`${BLOCKY}/settle`, hederaBody, {
      success: true,
      transactionId: HEDERA_TX,
      network: 'hedera:testnet',
      payer: '0.0.6006',
    }),
  ],
  'settle-evm-hash': [
    supported(BLOCKY, '0.0.7162784', false),
    post(`${BLOCKY}/settle`, hederaBody, {
      success: true,
      transaction: EVM_TX,
      network: 'hedera:testnet',
      payer: '0.0.6006',
    }),
  ],
  'settle-pending': [
    supported(BLOCKY, '0.0.7162784', false),
    post(`${BLOCKY}/settle`, hederaBody, {
      success: false,
      errorReason: 'settlement_pending',
      transaction: HEDERA_TX,
      network: 'hedera:testnet',
      payer: '0.0.6006',
    }),
    get(mirror, { transactions: [] }),
    get(mirror, {
      transactions: [
        {
          result: 'SUCCESS',
          transaction_id: '0.0.7162784-1793707200-123456789',
          consensus_timestamp: '1793707201.000000001',
        },
      ],
    }),
  ],
};
for (const [name, exchanges] of Object.entries(hedera))
  write(
    `facilitator/hedera/${name}.json`,
    recording(`hedera facilitator ${name}`, HEDERA_NOTE, exchanges),
  );

// ── eSIM Access open API (API-FACTS §5.1, esimaccess-api@b9421b3 references/api-reference.md) ─────────────
const ESIM_NOTE =
  '[verify Wed] authored from esimaccess-api@b9421b3 references/api-reference.md (envelope { success, errorCode, errorMsg, obj }, price ×10 000, volume bytes). Re-record with the console account: real packageCodes, the real `ac` (LPA) and its fill latency.';
const ESIM = 'https://api.esimaccess.com/api/v1/open';
const signed = {
  'RT-AccessCode': 'test-access-code',
  'RT-Timestamp': '*',
  'RT-RequestID': '*',
  'RT-Signature': '*',
};
const esimPost = (
  endpoint: string,
  body: unknown,
  obj: unknown,
  extra: Record<string, unknown> = {},
) => ({
  request: { method: 'POST', url: `${ESIM}${endpoint}`, body, expectHeaders: signed },
  response: {
    status: 200,
    body: { success: true, errorCode: null, errorMsg: null, obj, ...extra },
  },
});
const esimFail = (endpoint: string, body: unknown, errorCode: string, errorMsg: string) => ({
  request: { method: 'POST', url: `${ESIM}${endpoint}`, body, expectHeaders: signed },
  response: { status: 200, body: { success: false, errorCode, errorMsg, obj: null } },
});
const GB = 1_073_741_824;
const pkg = (
  packageCode: string,
  gb: number,
  days: number,
  price: number,
  extra: Record<string, unknown> = {},
) => ({
  packageCode,
  slug: packageCode.toLowerCase(),
  name: `India ${gb}GB ${days}Days`,
  price,
  retailPrice: price * 2,
  currencyCode: 'USD',
  volume: Math.round(gb * GB),
  duration: days,
  durationUnit: 'DAY',
  location: 'IN',
  speed: '4G/5G',
  supportTopUpType: 2,
  ...extra,
});
const listIn = { locationCode: 'IN', type: '', slug: '', packageCode: '', iccid: '' };
const plansObj = {
  packageList: [
    pkg('P-IN-1G-7D', 1, 7, 11400),
    pkg('P-IN-3G-30D', 3, 30, 27000),
    { ...pkg('P-IN-DAILY', 1, 1, 9000), durationUnit: 'MONTH' },
    pkg('P-IN-ODD', 0.5, 7, 8000, {
      name: '<script>alert(1)</script> India half a gig with a very long name that keeps going and going',
    }),
  ],
};
const txOf = (key: string) => sha256Hex(key).slice(2, 34);
const iccidFor = (i: number) => `89852240${String(i).padStart(12, '0')}`;
const esimRow = (
  i: number,
  orderNo: string,
  transactionId: string,
  over: Record<string, unknown> = {},
) => ({
  esimTranNo: `ESIM-TRAN-${i}`,
  orderNo,
  transactionId,
  imsi: '',
  iccid: iccidFor(i),
  msisdn: '',
  ac: `LPA:1$rsp.esimaccess.example$MATCH${i}ID`,
  qrCodeUrl: 'https://p.qrsim.net/example.png',
  shortUrl: '',
  smdpStatus: 'RELEASED',
  esimStatus: 'GOT_RESOURCE',
  eid: '',
  totalVolume: GB,
  orderUsage: 0,
  expiredTime: '2026-11-10T12:00:00+0000',
  ...over,
});
const query = (lookup: Record<string, unknown>) => ({
  ...lookup,
  pager: { pageNum: 1, pageSize: 20 },
});
const orderBody = (key: string, packageCode = 'P-IN-1G-7D') => ({
  transactionId: txOf(key),
  packageInfoList: [{ packageCode, count: 1 }],
});
const suite = (key: string, i: number) => {
  const orderNo = `B2611030000${i}`;
  return [
    esimPost('/esim/order', orderBody(key), { orderNo, transactionId: txOf(key) }),
    esimPost('/esim/query', query({ orderNo, iccid: '' }), {
      esimList: [esimRow(i, orderNo, txOf(key), { ac: '' })],
    }),
    esimPost('/esim/query', query({ orderNo, iccid: '' }), {
      esimList: [esimRow(i, orderNo, txOf(key))],
    }),
  ];
};
const byIccid = (i: number, over: Record<string, unknown> = {}) =>
  esimPost('/esim/query', query({ orderNo: '', iccid: iccidFor(i) }), {
    esimList: [esimRow(i, `B2611030000${i}`, 'x', over)],
  });
const topupList = {
  locationCode: '',
  type: 'TOPUP',
  slug: '',
  packageCode: '',
  iccid: iccidFor(1),
};
const esim: Record<string, unknown[]> = {
  plans: [esimPost('/package/list', listIn, plansObj)],
  order: [esimPost('/package/list', listIn, plansObj), ...suite('order-key-1', 1)],
  'query-pending': [
    esimPost('/esim/order', orderBody('pending-key'), {
      orderNo: 'B26110300009',
      transactionId: txOf('pending-key'),
    }),
    esimPost('/esim/query', query({ orderNo: 'B26110300009', iccid: '' }), {
      esimList: [esimRow(9, 'B26110300009', txOf('pending-key'), { ac: '' })],
    }),
  ],
  'order-duplicate': [
    esimFail('/esim/order', orderBody('dup-key'), '310402', 'duplicate transactionId'),
    esimPost('/esim/query', query({ orderNo: '', iccid: '', transactionId: txOf('dup-key') }), {
      esimList: [esimRow(5, 'B26110300005', txOf('dup-key'))],
    }),
  ],
  'order-bad-lpa': [
    esimPost('/esim/order', orderBody('bad-lpa'), {
      orderNo: 'B26110300006',
      transactionId: txOf('bad-lpa'),
    }),
    esimPost('/esim/query', query({ orderNo: 'B26110300006', iccid: '' }), {
      esimList: [esimRow(6, 'B26110300006', txOf('bad-lpa'), { ac: 'javascript:alert(1)' })],
    }),
  ],
  query: [byIccid(1, { smdpStatus: 'ENABLED', esimStatus: 'IN_USE', orderUsage: 250_000_000 })],
  'query-other-iccid': [
    esimPost('/esim/query', query({ orderNo: '', iccid: iccidFor(1) }), {
      esimList: [esimRow(2, 'B1', 'x')],
    }),
  ],
  'query-overflow': [byIccid(1, { orderUsage: 2 * GB })],
  usage: [byIccid(1, { orderUsage: 300_000_000, esimStatus: 'IN_USE' })],
  topup: [
    byIccid(1),
    esimPost('/package/list', topupList, {
      packageList: [
        pkg('TOPUP-IN-1G', 1, 7, 9000),
        pkg('TOPUP-IN-3G', 3, 30, 20000),
        { ...pkg('BASE-IN-1G', 1, 7, 9000), supportTopUpType: 1 },
      ],
    }),
    esimPost(
      '/esim/topup',
      {
        esimTranNo: 'ESIM-TRAN-1',
        iccid: '',
        packageCode: 'TOPUP-IN-1G',
        transactionId: sha256Hex('topup:topup-key-1').slice(2, 34),
      },
      null,
    ),
    byIccid(1, { totalVolume: 2 * GB }),
  ],
  errors: [
    esimFail('/package/list', listIn, '101003', 'signature mismatch'),
    esimFail('/package/list', listIn, '200007', 'insufficient balance'),
    esimFail('/package/list', listIn, '400001', 'invalid params'),
    esimFail('/package/list', listIn, '999999', 'unknown'),
  ],
  balance: [esimPost('/balance/query', {}, { balance: 1_000_000 })],
  // the live vendor (2026-11-06): /esim/cancel on an unused profile answers success, then the profile reads CANCEL
  cancel: [
    byIccid(1),
    esimPost('/esim/cancel', { esimTranNo: 'ESIM-TRAN-1' }, null),
    byIccid(1, { esimStatus: 'CANCEL' }),
  ],
  'contract-suite': [
    esimPost('/package/list', listIn, plansObj),
    ...suite('suite-order-1', 1),
    ...suite('suite-order-2', 2),
    byIccid(1, { orderUsage: 100_000_000 }),
    esimPost('/package/list', topupList, { packageList: [pkg('TOPUP-IN-1G', 1, 7, 9000)] }),
    esimPost(
      '/esim/topup',
      {
        esimTranNo: 'ESIM-TRAN-1',
        iccid: '',
        packageCode: 'TOPUP-IN-1G',
        transactionId: sha256Hex('topup:suite-topup-1').slice(2, 34),
      },
      null,
    ),
  ],
};
for (const [name, exchanges] of Object.entries(esim))
  write(`reseller/esimaccess/${name}.json`, recording(`eSIM Access ${name}`, ESIM_NOTE, exchanges));
const WEBHOOK_NOTE =
  '[verify Wed] the docs show no webhook JSON schema and no signature (A-27): these bodies are guesses from the notifyType list; capture a real delivery of each type.';
write('reseller/esimaccess/webhook-data-usage.json', {
  name: 'eSIM Access DATA_USAGE webhook',
  recordedAt: RECORDED_AT,
  source: 'docs',
  note: WEBHOOK_NOTE,
  rawBody: JSON.stringify({
    notifyType: 'DATA_USAGE',
    content: {
      orderNo: 'B26110300001',
      transactionId: txOf('order-key-1'),
      esimTranNo: 'ESIM-TRAN-1',
      iccid: iccidFor(1),
      totalVolume: GB,
      orderUsage: 999_000_000,
      remain: 74_741_824,
      lastUpdateTime: '2026-11-03T12:00:00+0000',
    },
  }),
});
write('reseller/esimaccess/webhook-check-health.json', {
  name: 'eSIM Access CHECK_HEALTH webhook',
  recordedAt: RECORDED_AT,
  source: 'docs',
  note: WEBHOOK_NOTE,
  rawBody: JSON.stringify({ notifyType: 'CHECK_HEALTH', content: {} }),
});
write('reseller/esimaccess/webhook-order-status.json', {
  name: 'eSIM Access ORDER_STATUS webhook',
  recordedAt: RECORDED_AT,
  source: 'docs',
  note: WEBHOOK_NOTE,
  rawBody: JSON.stringify({
    notifyType: 'ORDER_STATUS',
    content: { orderNo: 'B26110300001', orderStatus: 'GOT_RESOURCE' },
  }),
});
write('reseller/esimaccess/webhook-esim-status.json', {
  name: 'eSIM Access ESIM_STATUS webhook',
  recordedAt: RECORDED_AT,
  source: 'docs',
  note: WEBHOOK_NOTE,
  rawBody: JSON.stringify({
    notifyType: 'ESIM_STATUS',
    content: { iccid: iccidFor(1), smdpStatus: 'ENABLED', esimStatus: 'IN_USE' },
  }),
});

// ── ENS: viem getEnsAddress/getEnsText JSON-RPC (eth_call to the Universal Resolver), recorded off EnsResolver ──
const ENS_NOTE =
  '[verify Wed] authored by scripts/author-fixtures.ts: viem 2.57 eth_call to UniversalResolver.resolveWithGateways with ABI-encoded answers (alice.eth → Anvil #0). Re-record against ENS_RPC_URL (mainnet) for a real name.';
const ENS_RPC = 'https://eth.example.test/rpc';
const urAbi = parseAbi([
  'function resolveWithGateways(bytes name, bytes data, string[] gateways) view returns (bytes, address)',
]);
const inner = parseAbi([
  'function addr(bytes32 node) view returns (address)',
  'function text(bytes32 node, string key) view returns (string)',
]);
const RESOLVER = '0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63';
const records: Record<string, { address: string; avatar: string }> = {
  [namehash('alice.eth')]: { address: NAME_FIXTURE.address, avatar: NAME_FIXTURE.avatar },
};
function ensRecorder(sink: unknown[]): typeof fetch {
  return async (_url, init) => {
    const req = JSON.parse(init?.body as string) as {
      id: number;
      method: string;
      params: [{ to: string; data: Hex }, string];
    };
    const call = decodeFunctionData({ abi: urAbi, data: req.params[0].data });
    const q = decodeFunctionData({ abi: inner, data: call.args[1] });
    const rec = records[q.args[0]];
    let answer: Hex = '0x';
    if (rec && q.functionName === 'addr')
      answer = encodeAbiParameters([{ type: 'address' }], [rec.address as Hex]);
    if (rec && q.functionName === 'text' && q.args[1] === 'avatar')
      answer = encodeAbiParameters([{ type: 'string' }], [rec.avatar]);
    const result = encodeAbiParameters(
      [{ type: 'bytes' }, { type: 'address' }],
      [answer, answer === '0x' ? zeroAddress : RESOLVER],
    );
    const { id: _id, ...request } = req;
    sink.push({
      request: { method: 'POST', url: ENS_RPC, body: request },
      response: { status: 200, body: { jsonrpc: '2.0', id: 1, result } },
    });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }), {
      headers: { 'content-type': 'application/json' },
    });
  };
}
async function recordEns(name: string, run: (r: EnsResolver) => Promise<unknown>): Promise<void> {
  const sink: unknown[] = [];
  const client = createPublicClient({
    chain: mainnet,
    transport: http(ENS_RPC, { fetchFn: ensRecorder(sink) }),
  });
  await run(new EnsResolver({ mainnetClient: client }));
  write(`ens/${name}.json`, recording(`ens ${name}`, ENS_NOTE, sink));
}
await recordEns('resolve-ok', (r) => r.resolve('alice.eth'));
await recordEns('resolve-null', (r) => r.resolve('nobody.eth'));
await recordEns('text-avatar', (r) => r.getText('alice.eth', 'avatar'));
await recordEns('contract-suite', async (r) => {
  await r.resolve('alice.eth');
  await r.resolve('nobody.eth');
  await r.getText('nobody.eth', 'avatar');
  await r.getText('alice.eth', 'avatar');
});

// ── HCS: mirror REST page (hedera-docs openapi.yaml) + an SDK receipt; HCS-14 vectors recorded from standards-sdk ──
const HCS_NOTE =
  '[verify Wed] authored from hedera-docs@836b856 openapi.yaml (topics/{id}/messages) and @hiero-ledger/sdk 2.90.1 TransactionReceipt; re-record against HCS_TOPIC_ID.';
const MIRROR = 'https://testnet.mirrornode.hedera.com';
const msg = (n: number) => ({
  chunk_info: null,
  consensus_timestamp: `${1793707200 + n}.00000000${n}`,
  message: Buffer.from(JSON.stringify({ v: 1, n })).toString('base64'),
  payer_account_id: '0.0.6006',
  running_hash: Buffer.from(`hash-${n}`).toString('base64'),
  running_hash_version: 3,
  sequence_number: n,
  topic_id: '0.0.4242',
});
const page = (from: number) =>
  `${MIRROR}/api/v1/topics/0.0.4242/messages?sequencenumber=gte:${from}&limit=100&order=asc`;
write(
  'hcs/mirror-messages.json',
  recording('hcs mirror messages, two pages', HCS_NOTE, [
    get(page(1), {
      messages: [msg(1), msg(2)],
      links: { next: '/api/v1/topics/0.0.4242/messages?sequencenumber=gte:3&limit=100&order=asc' },
    }),
    get(page(3), { messages: [msg(3)], links: { next: null } }),
    get(
      `${MIRROR}/api/v1/topics/0.0.9999/messages?sequencenumber=gte:1&limit=100&order=asc`,
      { _status: { messages: [{ message: 'Not found' }] } },
      404,
    ),
    get(`${MIRROR}/api/v1/topics/0.0.7777/messages?sequencenumber=gte:1&limit=100&order=asc`, {
      messages: 'nope',
    }),
  ]),
);
write('hcs/submit-receipt.json', {
  name: 'TopicMessageSubmitTransaction receipt + record',
  recordedAt: RECORDED_AT,
  source: 'docs',
  note: HCS_NOTE,
  receipt: { status: 'SUCCESS', topicSequenceNumber: '3', topicRunningHashVersion: '3' },
  record: { consensusTimestamp: '1793707203.000000003' },
  transactionId: '0.0.6006@1793707195.000000000',
});
// Recorded from @hashgraphonline/standards-sdk@0.1.192 createUaid(input, { proto: 'x402' }) on 2026-11-05. The SDK is
// not a devDependency any more: every version of it pulls the banned @hashgraph/sdk and v1 x402-axios (deps-check §7).
const uaidInput = {
  registry: 'hedera',
  name: 'Recharge Agent',
  version: '1.0.0',
  protocol: 'x402',
  nativeId: 'hedera:testnet:0.0.6006',
  skills: [3, 1],
} as const;
write('hcs/hcs14-vector.json', {
  name: 'HCS-14 self-issued UAID vector',
  recordedAt: RECORDED_AT,
  source: 'docs',
  note: 'recorded from @hashgraphonline/standards-sdk@0.1.192 createUaid(input, { proto: "x402" }) (A-29); the SDK is not installed (it pulls the banned @hashgraph/sdk and x402-axios, deps-check §7), so these are frozen reference values checked in consensus-names-blobs.test.ts and services/agent identity.test.ts',
  input: uaidInput,
  uaid: 'uaid:aid:4K54ZoTRiQcP4AHwsaMSLtpWwiWNQ9vaCxKEy6cvSBNoxZcCoo2AjrbnBNscE34wh2;uid=0;registry=hedera;proto=x402;nativeId=hedera:testnet:0.0.6006',
  cases: [
    {
      name: 'name trimmed, skills sorted',
      input: { ...uaidInput, name: '  Recharge Agent ', skills: [9, 0, 4] },
      uaid: 'uaid:aid:9RWdfpict4tUaGGDLGUev58TvsJCbBYwN8mPYefifxTNrier8iqhGJcsbVttuA3VxX;uid=0;registry=hedera;proto=x402;nativeId=hedera:testnet:0.0.6006',
    },
    {
      name: 'no skills',
      input: { ...uaidInput, skills: [] },
      uaid: 'uaid:aid:7PTRahZEhictGXAkWH6XvcZHftqt9ShbcBhdnjs1b1A81PHqYmhpihfsd4ELLkMdWT;uid=0;registry=hedera;proto=x402;nativeId=hedera:testnet:0.0.6006',
    },
    {
      name: "services/agent uaidInput('0.0.6006') at version 0.1.0",
      input: { ...uaidInput, name: 'recharge-topup-agent', version: '0.1.0', skills: [] },
      uaid: 'uaid:aid:5rkfuoErGg2CAfs7hJzcvww7oDbH4ynGpV9UFkp6UAKQLST7uMUKRYi4Ebgfg3AYH5;uid=0;registry=hedera;proto=x402;nativeId=hedera:testnet:0.0.6006',
    },
  ],
});

// ── Swarm Bee (ethersphere/bee@ed32cfa openapi/Swarm.yaml) ─────────────────────────────────────────────────
const SWARM_NOTE =
  '[verify Wed] authored from ethersphere/bee@ed32cfa openapi/Swarm.yaml (POST /bzz → { reference }); no hosted gateway/batch is confirmed for the hackathon.';
const BEE = 'http://localhost:1633';
const REF = 'ab'.repeat(32);
const sealedBox = JSON.stringify({
  v: 1,
  alg: 'x25519-xchacha20poly1305',
  epk: 'AAAA',
  nonce: 'BBBB',
  ct: 'CCCC',
});
write(
  'swarm/upload.json',
  recording('bee upload', SWARM_NOTE, [
    {
      request: {
        method: 'POST',
        url: `${BEE}/bzz`,
        expectHeaders: {
          'swarm-postage-batch-id': 'cd'.repeat(32),
          'content-type': 'application/json',
        },
      },
      response: { status: 201, body: { reference: REF } },
    },
  ]),
);
write(
  'swarm/upload-too-large.json',
  recording('bee upload 413', SWARM_NOTE, [
    {
      request: { method: 'POST', url: `${BEE}/bzz` },
      response: { status: 413, body: { code: 413, message: 'payload too large' } },
    },
  ]),
);
write(
  'swarm/download.json',
  recording('bee download', SWARM_NOTE, [
    {
      request: { method: 'GET', url: `${BEE}/bzz/${REF}/` },
      response: { status: 200, headers: { 'content-type': 'application/json' }, body: sealedBox },
    },
    {
      request: { method: 'GET', url: `${BEE}/bzz/${'00'.repeat(32)}/` },
      response: { status: 404, body: { code: 404, message: 'Not Found' } },
    },
  ]),
);

// ── EIP-712 domains per chain (A-21) ──────────────────────────────────────────────────────────────────────
write('eip3009/domains.json', {
  name: 'USDC EIP-712 domains per chain',
  recordedAt: RECORDED_AT,
  source: 'docs',
  note: '[verify Wed] `cast call <usdc> "name()(string)"` and "version()(string)" on each chain; Base Sepolia is "USDC" (API-FACTS §7). 31337 is MockUSDC3009 (packages/contracts).',
  domains: [
    {
      network: 'eip155:31337',
      token: 'deploy/addresses.anvil.json#usdc',
      ...USDC_EIP712_DOMAIN['eip155:31337'],
    },
    {
      network: 'eip155:84532',
      token: USDC_ASSET['eip155:84532'],
      ...USDC_EIP712_DOMAIN['eip155:84532'],
    },
    {
      network: 'eip155:8453',
      token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      ...USDC_EIP712_DOMAIN['eip155:8453'],
    },
  ],
});

console.log('fixtures authored');
