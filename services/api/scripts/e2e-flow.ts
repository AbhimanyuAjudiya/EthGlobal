/**
 * The Anvil-backed BUILD-PLAN §4 loop, run by scripts/e2e-local.sh against a live API (MODE=local,
 * X402_FACILITATOR=self): real DataDrop.claim with a Claimed log, real MockUSDC3009 transferWithAuthorization in
 * PAYMENT-RESPONSE, then the webhook, gift, card, sponsor, expiry and reclaim steps. One PASS/FAIL line per step;
 * the first failure exits 1. Time travel (I-16/I-17) moves the API's local clock and Anvil's together.
 */
import { readFileSync } from 'node:fs';

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  namehash,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';

import { DEFAULT_MOCK_WEBHOOK_SECRET, MockReseller } from '@ethglobal/adapters';
import { anvilAccounts, anvilKeys, anvilRoles, fixtureProof } from '@ethglobal/adapters/testing';
import DataDropAbi from '@ethglobal/contracts/abi/DataDrop.json' with { type: 'json' };
import UsdcAbi from '@ethglobal/contracts/abi/MockUSDC3009.json' with { type: 'json' };
import {
  bytesToHex,
  generateSessionKeypair,
  lpaAad,
  openLpa,
  type SealedBox,
} from '@ethglobal/crypto';
import { httpJson } from '@ethglobal/protocol/http';
import { isValidPin } from '@ethglobal/protocol/pin';
import type { ChallengeWire, EntitledResponse, GiftResponse } from '@ethglobal/protocol/schemas';
import {
  decodePaymentRequired,
  decodePaymentResponse,
  PAYMENT_SIGNATURE_HEADER,
} from '@ethglobal/protocol/x402';

import { loadAddresses } from '../src/accepts.js';
import {
  addressOf,
  paymentHeader,
  scopedCampaignId,
  signGiftClaim,
  signGiftReclaim,
  sponsorAuthorization,
  sponsorLogin,
} from '../test/support/client.js';

const API = process.env.API_URL ?? 'http://127.0.0.1:8788';
const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8546';
const LOG = process.env.API_LOG;
const CHAIN_ID = 31337;
const DAY_S = 86_400;
const deployed = loadAddresses('anvil');
if (!deployed)
  throw new Error('deploy/addresses.anvil.json missing: run scripts/dev-chain.sh first');
const addresses = deployed as unknown as { dataDrop: Address; usdc: Address; payout: Address };

const publicClient = createPublicClient({
  chain: foundry,
  pollingInterval: 200,
  transport: http(RPC),
});
const wallet = (key: Hex) =>
  createWalletClient({ chain: foundry, account: privateKeyToAccount(key), transport: http(RPC) });
const human = anvilKeys[anvilRoles.human];
const sponsorKey = anvilKeys[anvilRoles.sponsor];
const bobKey = anvilKeys[1];
const started = performance.now();
let ip = 0;

function check(ok: unknown, what: string): asserts ok {
  if (!ok) throw new Error(what);
}

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  const t = performance.now();
  try {
    await fn();
    console.log(`PASS ${name} (${Math.round(performance.now() - t)} ms)`);
  } catch (error) {
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/** One call to the API; each gets its own client address (TRUST_PROXY=1) so per-IP limits stay out of the way. */
async function call(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; headers?: Record<string, string> } = {},
) {
  ip += 1;
  const { status, headers, data } = await httpJson(`${API}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: { 'x-forwarded-for': `203.0.113.${ip % 250}`, ...init.headers },
    ...(init.body === undefined ? {} : { body: init.body }),
    allowStatus: [200, 201, 202, 204, 400, 401, 402, 404, 409, 410, 423, 429],
    timeoutMs: 30_000,
  });
  return { status, headers, data: data as Record<string, unknown> };
}

const challenge = async (path: string, sessionPubKey: Hex) =>
  (await call('/challenge', { body: { audience: 'recharge', path, sessionPubKey } }))
    .data as unknown as ChallengeWire;

async function pay(
  required: Headers,
  opts: { sessionPubKey?: Hex } = {},
): Promise<Record<string, string>> {
  const req = decodePaymentRequired(required.get('PAYMENT-REQUIRED') ?? '');
  const block = await publicClient.getBlock();
  const header = await paymentHeader(human, req.accepts[0]!, {
    now: Number(block.timestamp) * 1000,
    ...opts,
  });
  return { [PAYMENT_SIGNATURE_HEADER]: header };
}

async function advance(seconds: number): Promise<void> {
  await call('/__local/clock', { body: { advanceMs: seconds * 1000 } });
  await publicClient.request({ method: 'evm_increaseTime' as never, params: [seconds] as never });
  await publicClient.request({ method: 'evm_mine' as never, params: [] as never });
}

const balance = (who: Address) =>
  publicClient.readContract({
    address: addresses.usdc,
    abi: UsdcAbi as Abi,
    functionName: 'balanceOf',
    args: [who],
  }) as Promise<bigint>;

async function claimedLogs(tx: Hex): Promise<number> {
  const receipt = await publicClient.getTransactionReceipt({ hash: tx });
  return receipt.logs.filter((log) => {
    try {
      return (
        decodeEventLog({ abi: DataDropAbi as Abi, data: log.data, topics: log.topics })
          .eventName === 'Claimed'
      );
    } catch {
      return false;
    }
  }).length;
}

const sponsor = addressOf(sponsorKey);
const campaignId = scopedCampaignId(sponsor, BigInt(Date.now()));
let claimed: EntitledResponse;
let entKey = '';
let gift: GiftResponse;

await step('I-0 sponsor funds a campaign on Anvil and registers it (POST /sponsor)', async () => {
  const block = await publicClient.getBlock();
  const now = Number(block.timestamp);
  const w = wallet(sponsorKey);
  const budget = 1_000_000_000n;
  await publicClient.waitForTransactionReceipt({
    hash: await w.writeContract({
      address: addresses.usdc,
      abi: UsdcAbi as Abi,
      functionName: 'approve',
      args: [addresses.dataDrop, budget],
    }),
  });
  const created = await w.writeContract({
    address: addresses.dataDrop,
    abi: DataDropAbi as Abi,
    functionName: 'createCampaign',
    args: [campaignId, budget, 500_000n, 120, BigInt(now + 30 * DAY_S)],
  });
  check(
    (await publicClient.waitForTransactionReceipt({ hash: created })).status === 'success',
    'createCampaign reverted',
  );
  const login = await sponsorLogin(sponsorKey, CHAIN_ID, campaignId, now * 1000);
  const res = await call('/sponsor', {
    body: {
      campaign: {
        id: campaignId,
        sponsor,
        name: 'Mumbai Welcome (e2e)',
        bundleMb: { orb: 300, document: 160, device: 0 },
        pricePerClaimUsd6: '500000',
        maxClaims: 2000,
        claimsPerHour: 120,
        validityDays: 7,
        wholesaleUsd6PerGb: '1140000',
        idResaleUsd6: '500000',
        planId: 'in-300mb-7d',
        network: 'eip155:31337',
        contract: addresses.dataDrop,
        expiresAt: (now + 30 * DAY_S) * 1000,
      },
      auth: { issuedAt: login.issuedAt, signature: login.signature },
    },
  });
  check(res.status === 201 && typeof res.data.auditKey === 'string', `POST /sponsor ${res.status}`);
});

const keys = generateSessionKeypair();
const spk = bytesToHex(keys.publicKey);
let ch: ChallengeWire;

await step('I-1 challenge (MAC-bound, 120 s)', async () => {
  ch = await challenge('/claim', spk);
  check(ch.exp > Date.now() && /^0x[0-9a-f]{64}$/.test(ch.nonce), 'bad challenge');
});

await step('I-2 rp-context (ttl 300)', async () => {
  const res = await call('/world/rp-context', { body: { audience: 'recharge', path: '/claim' } });
  check(
    res.status === 200 && Number(res.data.expires_at) - Number(res.data.created_at) === 300,
    'bad rp_context',
  );
});

const humanSeed = `e2e-${Date.now()}`;
await step(
  'I-3 claim: sealed LPA opens, one Claimed log, payout +500000, HCS receipt',
  async () => {
    const before = await balance(addresses.payout);
    const res = await call('/claim', {
      body: {
        proof: fixtureProof('orb', ch.signal as Hex, humanSeed),
        campaignId,
        challenge: ch,
        sessionPubKey: spk,
      },
    });
    check(res.status === 201, `claim ${res.status} ${JSON.stringify(res.data)}`);
    claimed = res.data as unknown as EntitledResponse;
    entKey = claimed.entitlementKey;
    check(
      openLpa(
        claimed.sealedLpa as SealedBox,
        keys.secretKey,
        lpaAad(ch.nonce as Hex, entKey),
      ).startsWith('LPA:1$local.test$'),
      'LPA did not open',
    );
    check((await claimedLogs(claimed.claimTx as Hex)) === 1, 'no Claimed log');
    check(
      (await balance(addresses.payout)) - before === 500_000n,
      'payout did not receive the claim price',
    );
    check(claimed.receipt.hcs !== undefined, 'no HCS receipt');
  },
);

await step('I-5 replay of the same human ⇒ 409', async () => {
  const c2 = await challenge('/claim', spk);
  const again = await call('/claim', {
    body: {
      proof: fixtureProof('orb', c2.signal as Hex, humanSeed),
      campaignId,
      challenge: c2,
      sessionPubKey: spk,
    },
  });
  check(again.status === 409, `replay ${again.status}`);
});

await step('I-6 /me twice (cached) and receipts', async () => {
  const k = encodeURIComponent(entKey);
  const a = await call(`/me/${k}`);
  const b = await call(`/me/${k}`);
  check(a.data.cached === false && b.data.cached === true, 'cache');
  const r = await call(`/me/${k}/receipts`);
  check(
    JSON.stringify(r.data).includes('"claim"') &&
      !JSON.stringify(r.data).includes('entitlementKeyHash'),
    'receipts',
  );
});

await step(
  'I-7/I-8/I-9 402 → EIP-3009 on MockUSDC3009 → 200 + PAYMENT-RESPONSE; resend ⇒ 402',
  async () => {
    const path = `/esim/topup?key=${encodeURIComponent(entKey)}&mb=100`;
    const quote = await call(path);
    check(
      quote.status === 402 && !/"maxAmount(?:Required)"/.test(JSON.stringify(quote.data)),
      `quote ${quote.status}`,
    );
    const before = await balance(addresses.payout);
    const headers = await pay(quote.headers);
    const paid = await call(path, { headers });
    check(paid.status === 200, `topup ${paid.status} ${JSON.stringify(paid.data)}`);
    const settlement = decodePaymentResponse(paid.headers.get('PAYMENT-RESPONSE') ?? '');
    check(settlement.success, 'settlement failed');
    const receipt = await publicClient.getTransactionReceipt({
      hash: settlement.transaction as Hex,
    });
    check(receipt.status === 'success', 'settlement tx not on chain');
    check((await balance(addresses.payout)) - before === 400_000n, 'payout did not receive 400000');
    check(paid.data.mbTotal === claimed.mbTotal + 100, 'mbTotal +100');
    const again = await call(path, { headers });
    check(again.status === 402, `resend ${again.status}`);
  },
);

await step('I-11 webhook: 204, cache invalidated; replay 409; tampered 401; skew 401', async () => {
  // MockReseller is deterministic: the same idempotency key gives the same ICCID the API's reseller assigned
  const iccid = (await new MockReseller().order('in-300mb-7d', { idempotencyKey: entKey })).iccid;
  const signer = new MockReseller({ webhookSecret: DEFAULT_MOCK_WEBHOOK_SECRET });
  const nowMs = Number((await call('/__local/clock', { body: { advanceMs: 0 } })).data.now);
  const hook = (usedMb: number, at = nowMs) =>
    signer.signedWebhook(
      [{ provider: 'mock', eventId: `e2e-${usedMb}-${at}`, iccid, usedMb, totalMb: 400, asOf: at }],
      at,
    );
  const send = (d: { body: string; headers: Record<string, string> }) =>
    httpJson(`${API}/webhooks/reseller/mock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...d.headers },
      rawBody: d.body,
      allowStatus: [204, 401, 409],
    });
  const d = hook(42);
  check((await send(d)).status === 204, 'valid webhook');
  const me = await call(`/me/${encodeURIComponent(entKey)}`);
  check(me.data.mbUsed === 42 && me.data.cached === false, 'usage not patched');
  check((await send(d)).status === 409, 'replay');
  check(
    (await send({ body: hook(50).body.replace('50', '51'), headers: hook(50).headers })).status ===
      401,
    'tampered',
  );
  check((await send(hook(60, nowMs - 301_000))).status === 401, 'skew');
});

await step('I-12 gift: nobody.eth 404 before 402; bob.eth 402 → pay → 201 with PIN', async () => {
  const nobody = await call('/gift', { body: { name: 'nobody.eth', mb: 1000 } });
  check(nobody.status === 404 && nobody.headers.get('PAYMENT-REQUIRED') === null, 'nobody.eth');
  const quote = await call('/gift', { body: { name: 'bob.eth', mb: 1000 } });
  check(quote.status === 402, `gift quote ${quote.status}`);
  const res = await call('/gift', {
    body: { name: 'bob.eth', mb: 1000 },
    headers: await pay(quote.headers),
  });
  check(res.status === 201, `gift ${res.status} ${JSON.stringify(res.data)}`);
  gift = res.data as unknown as GiftResponse;
  check(isValidPin(gift.pin) && gift.serial === gift.giftId.slice(2, 10), 'pin/serial');
});

await step('I-13 gift claim by bob’s GiftClaim signature ⇒ giftent:; again 409', async () => {
  const bob = bytesToHex(generateSessionKeypair().publicKey);
  const send = async () => {
    const c = await challenge('/gift/claim', bob);
    const signature = await signGiftClaim(bobKey, CHAIN_ID, {
      giftId: gift.giftId as Hex,
      namehash: namehash('bob.eth'),
      nonce: c.nonce as Hex,
    });
    return call('/gift/claim', {
      body: {
        giftId: gift.giftId,
        signature,
        recipient: anvilAccounts[1],
        challenge: c,
        sessionPubKey: bob,
      },
    });
  };
  const res = await send();
  check(
    res.status === 201 && res.data.entitlementKey === `giftent:${gift.giftId}`,
    `gift claim ${res.status}`,
  );
  check((await send()).status === 409, 'second claim');
});

await step(
  'I-14 card: GET ×2 unchanged → redeem ⇒ 201 + a second Claimed; again ⇒ 410',
  async () => {
    const card = (
      await call('/gift', {
        body: { name: 'card', mb: 300 },
        headers: { 'x-seed-card-campaign': campaignId },
      })
    ).data as { serial: string; pin: string };
    const a = await call(`/card/${card.serial}`);
    const b = await call(`/card/${card.serial}`);
    check(
      JSON.stringify(a.data) === JSON.stringify(b.data) && a.data.state === 'open',
      'preview changed',
    );
    const s = bytesToHex(generateSessionKeypair().publicKey);
    const redeem = async () =>
      call('/card/redeem', {
        body: { pin: card.pin, challenge: await challenge('/card/redeem', s), sessionPubKey: s },
      });
    const res = await redeem();
    check(
      res.status === 201 && (await claimedLogs(res.data.claimTx as Hex)) === 1,
      `redeem ${res.status}`,
    );
    check((await redeem()).status === 410, 'second redeem');
  },
);

let shortKey = '';
await step('I-15 sponsor dashboard: claim keys only, chain counters, expiring', async () => {
  const s = bytesToHex(generateSessionKeypair().publicKey);
  const c = await challenge('/claim', s);
  const res = await call('/claim', {
    body: {
      proof: fixtureProof('orb', c.signal as Hex, `e2e-90s-${Date.now()}`),
      campaignId,
      challenge: c,
      sessionPubKey: s,
    },
    headers: { 'x-seed-validity-s': '90' },
  });
  check(res.status === 201, `90-s claim ${res.status}`);
  shortKey = String(res.data.entitlementKey);
  await call(`/me/${encodeURIComponent(shortKey)}`);
  const block = await publicClient.getBlock();
  const auth = await sponsorAuthorization(
    sponsorKey,
    CHAIN_ID,
    campaignId,
    Number(block.timestamp) * 1000,
  );
  const view = await call(`/sponsor/${campaignId}`, { headers: { authorization: auth } });
  check(view.status === 200, `sponsor ${view.status}`);
  const claims = view.data.claims as { campaignClaimKey: string }[];
  check(
    claims.length === 2 && claims.every((r) => /^0x[0-9a-f]{64}$/.test(r.campaignClaimKey)),
    'claims list',
  );
  check((view.data.chain as { spentUsd6: string }).spentUsd6 === '1500000', 'chain counters');
  check((view.data.expiring as unknown[]).length >= 1, 'expiring');
});

await step('I-16 expiry: the 90-s entitlement ⇒ 410', async () => {
  await advance(91);
  check((await call(`/me/${encodeURIComponent(shortKey)}`)).status === 410, 'not expired');
});

await step(
  'I-17 reclaim: a lapsed gift refunds once; again 409; the claimed gift 409',
  async () => {
    const quote = await call('/gift', { body: { name: 'alice.eth', mb: 100 } });
    const lapsed = (
      await call('/gift', {
        body: { name: 'alice.eth', mb: 100 },
        headers: await pay(quote.headers),
      })
    ).data as unknown as GiftResponse;
    await advance(7 * DAY_S + 1);
    const payer = addressOf(human);
    const reclaim = async (giftId: string) => {
      const c = await challenge(
        '/gift/reclaim',
        `0x${payer.slice(2).toLowerCase().padStart(64, '0')}`,
      );
      const signature = await signGiftReclaim(human, CHAIN_ID, {
        giftId: giftId as Hex,
        nonce: c.nonce as Hex,
      });
      return call('/gift/reclaim', { body: { giftId, payer, signature, challenge: c } });
    };
    const res = await reclaim(lapsed.giftId);
    check(
      res.status === 200 && res.data.refundedUsd6 === '400000',
      `reclaim ${res.status} ${JSON.stringify(res.data)}`,
    );
    check((await reclaim(lapsed.giftId)).status === 409, 'second reclaim');
    check((await reclaim(gift.giftId)).status === 409, 'claimed gift reclaimed');
  },
);

await step('I-18 secrets scan of the API log', async () => {
  if (LOG === undefined) return;
  const log = readFileSync(LOG, 'utf8');
  check(!log.includes('LPA:1$'), 'LPA in log');
  check(!log.includes(gift.pin), 'PIN in log');
  check(!/PAYMENT-SIGNATURE[":\s]+[A-Za-z0-9+/=]{40,}/i.test(log), 'payment signature in log');
  check(!/[?&]token=/.test(log), 'token in log');
});

console.log(`e2e-flow: ${Math.round(performance.now() - started)} ms`);
