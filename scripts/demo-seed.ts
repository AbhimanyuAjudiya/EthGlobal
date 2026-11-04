/**
 * scripts/demo-seed.ts — the state every demo and test starts from (ops-demo §2). It runs against a live MODE=local
 * stack (Anvil + Deploy.s.sol from scripts/dev-chain.sh, and the API with TRUST_PROXY=1) and writes nothing to the
 * ledger itself: every object goes through DataDrop from the sponsor's wallet or through the API's public routes.
 * The only shortcuts are the API's three MODE=local seed hooks (services/api/src/seed.ts), which live mode ignores.
 *
 *   1. chain     sponsor role: approve MockUSDC3009 → DataDrop.createCampaign(scopedCampaignId(sponsor, salt), …)
 *                1 000 USDC budget, 0.50 per claim, 120 claims/h, 14 days; the id is sponsor-scoped (RT-C-02)
 *   2. ledger    POST /sponsor (SponsorLogin) → audit key in .e2e/audit-key.txt (local only)
 *   3. entitled  three tiers, all through the API:
 *                  orb      free POST /claim, 300 MB, a signed mock webhook puts usage at 60 %
 *                  paid     GET /esim/provision 402 → EIP-3009 by the human role → 300 MB, webhook to 82 % used
 *                           (54 MB left: the agent's trigger), PUT /agent/policy signed by the human
 *                  document free POST /claim, 150 MB, X-Seed-Validity-S: 90 (dies on screen)
 *   4. gift      POST /gift { name: 'rahul.eth', mb: 1000 } 402 → paid by a second wallet (the `stranger` role,
 *                Anvil #7: the self-run facilitator allows 5 settlements per payer per minute, and the e2e flow
 *                pays three times from the human role right after the seed); mock resolver: rahul.eth → Anvil #9
 *   5. cards     ten campaign-funded scratch cards, POST /gift with X-Seed-Card-Campaign (no payment)
 *   6. state     .e2e/{state,keys,gift,cards}.json (PINs and keys: local only, git-ignored);
 *                with --fixtures also fixtures/demo/*.json (no PINs, no keys)
 *
 *   pnpm demo:seed                       # API_URL (default :8787), RPC_URL (default :8545)
 *   pnpm demo:seed -- --reset            # re-seed from scratch (same campaign id)
 *   pnpm demo:seed -- --fixtures         # also refresh fixtures/demo/*.json
 *
 * Idempotent: without --reset, an existing .e2e/state.json whose three entitlements still answer GET /me 200 is
 * reused and only printed. The campaign id is a pure function of the sponsor and the campaign name, so --reset twice
 * gives the same id (createCampaign is skipped when the chain already has it).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { keccak256, toBytes, toHex, type Address, type Hex } from 'viem';

import { fixtureProof } from '@ethglobal/adapters/testing';
import { bytesToHex, generateSessionKeypair } from '@ethglobal/crypto';
import { isValidPin } from '@ethglobal/protocol/pin';
import type { EntitledResponse, GiftResponse, TopUpPolicyWire } from '@ethglobal/protocol/schemas';
import { SESSION_PUBKEY_HEADER } from '@ethglobal/protocol/x402';

import { cliArgs } from './lib/harness.js';
import {
  anvilAddresses,
  apiClient,
  check,
  CHAIN_ID,
  dataDropAbi,
  payHeaders,
  publicClientFor,
  reportUsage,
  roleAddress,
  roleKey,
  stackFromEnv,
  usdcAbi,
  walletFor,
} from './lib/stack.js';
import { agentPolicyPut, sponsorLogin } from '../services/api/test/support/client.js';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, '.e2e');
const FIXTURES = join(ROOT, 'fixtures', 'demo');
const SEED_FILES = ['state.json', 'keys.json', 'gift.json', 'cards.json', 'audit-key.txt'];

export const CAMPAIGN_NAME = 'Recharge (demo sponsor)';
const DAY_S = 86_400;
const BUDGET = 1_000_000_000n;
const PRICE_PER_CLAIM = 500_000n;
const CLAIMS_PER_HOUR = 120;
const CARD_COUNT = 10;
const CARD_MB = 300;
export const AGENT_POLICY: TopUpPolicyWire = {
  maxUsd6PerDay: '10000000',
  thresholdMb: 60,
  stepMb: 100,
  paused: false,
  topUpOnExpiry: true,
  expiryLeadS: 1800,
};

export interface SeededEntitlement {
  label: 'orb' | 'paid' | 'document';
  key: string;
  tier: string;
  mbTotal: number;
  mbUsed: number;
  expiresAt: number;
  planUrl: string;
}

export interface SeedState {
  seededAt: string;
  apiUrl: string;
  rpcUrl: string;
  chainId: number;
  addresses: { dataDrop: Address; usdc: Address; payout: Address; sponsor: Address };
  campaignId: Hex;
  txs: { approve?: Hex; createCampaign?: Hex; claims: string[]; payments: string[] };
  entitlements: SeededEntitlement[];
  gift: { giftId: string; serial: string; name: string; mb: number; claimBy: number };
  cards: { serial: string; mb: number }[];
}

const { values: flags } = parseArgs({
  args: cliArgs(),
  options: {
    reset: { type: 'boolean', default: false },
    fixtures: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
  },
});
const say = (line: string) => {
  if (!flags.quiet) console.log(line);
};

const stack = stackFromEnv();
const api = apiClient(stack);
const chain = publicClientFor(stack);
const deployed = anvilAddresses();
const sponsor = roleAddress('sponsor');
const webBase = process.env.WEB_URL ?? 'http://127.0.0.1:3000';
const started = performance.now();

/** Every key still answers 200 ⇒ the seed is live in this API process. */
async function stillLive(state: SeedState): Promise<boolean> {
  for (const e of state.entitlements) {
    if ((await api.request(`/me/${encodeURIComponent(e.key)}`)).status !== 200) return false;
  }
  return true;
}

/** salt = the first 8 bytes of keccak256(name ‖ 'seed'); id = DataDrop.scopedCampaignId(sponsor, salt). */
async function campaignIdFor(): Promise<Hex> {
  const salt = BigInt(keccak256(toBytes(`${CAMPAIGN_NAME}|seed`)).slice(0, 18));
  return (await chain.readContract({
    address: deployed.dataDrop,
    abi: dataDropAbi,
    functionName: 'scopedCampaignId',
    args: [sponsor, salt],
  })) as Hex;
}

async function fundCampaign(id: Hex, txs: SeedState['txs']): Promise<number> {
  const block = await chain.getBlock();
  const now = Number(block.timestamp);
  const existing = (await chain.readContract({
    address: deployed.dataDrop,
    abi: dataDropAbi,
    functionName: 'campaigns',
    args: [id],
  })) as { sponsor: Address; expiresAt: bigint };
  if (BigInt(existing.sponsor) !== 0n) {
    say(`chain     campaign ${id} already funded on Anvil (createCampaign skipped)`);
    return Number(existing.expiresAt);
  }
  const wallet = walletFor(stack, 'sponsor');
  txs.approve = await wallet.writeContract({
    address: deployed.usdc,
    abi: usdcAbi,
    functionName: 'approve',
    args: [deployed.dataDrop, BUDGET],
  });
  await chain.waitForTransactionReceipt({ hash: txs.approve });
  const expiresAt = now + 14 * DAY_S;
  txs.createCampaign = await wallet.writeContract({
    address: deployed.dataDrop,
    abi: dataDropAbi,
    functionName: 'createCampaign',
    args: [id, BUDGET, PRICE_PER_CLAIM, CLAIMS_PER_HOUR, BigInt(expiresAt)],
  });
  const receipt = await chain.waitForTransactionReceipt({ hash: txs.createCampaign });
  check(receipt.status === 'success', 'createCampaign reverted');
  say(`chain     approve ${txs.approve}`);
  say(`chain     createCampaign ${txs.createCampaign} (1 000 USDC, 0.50/claim, 120/h, 14 d)`);
  return expiresAt;
}

async function registerCampaign(id: Hex, expiresAt: number): Promise<string | undefined> {
  const login = await sponsorLogin(roleKey('sponsor'), CHAIN_ID, id, await api.now());
  const res = await api.request('/sponsor', {
    body: {
      campaign: {
        id,
        sponsor,
        name: CAMPAIGN_NAME,
        bundleMb: { orb: 300, document: 150, device: 0 },
        pricePerClaimUsd6: PRICE_PER_CLAIM.toString(),
        maxClaims: Number(BUDGET / PRICE_PER_CLAIM),
        claimsPerHour: CLAIMS_PER_HOUR,
        validityDays: 7,
        wholesaleUsd6PerGb: '1140000',
        idResaleUsd6: '500000',
        planId: 'in-300mb-7d',
        network: `eip155:${CHAIN_ID}`,
        contract: deployed.dataDrop,
        expiresAt: expiresAt * 1000,
      },
      auth: { issuedAt: login.issuedAt, signature: login.signature },
    },
    expect: [201, 409],
  });
  say(
    `ledger    POST /sponsor → ${res.status}${res.status === 409 ? ' (already registered)' : ''}`,
  );
  return typeof res.data.auditKey === 'string' ? res.data.auditKey : undefined;
}

async function freeClaim(
  campaignId: Hex,
  level: 'orb' | 'document',
  humanSeed: string,
  headers: Record<string, string> = {},
): Promise<EntitledResponse> {
  const session = bytesToHex(generateSessionKeypair().publicKey);
  const challenge = await api.challenge('/claim', session);
  const res = await api.request('/claim', {
    body: {
      proof: fixtureProof(level, challenge.signal as Hex, humanSeed),
      campaignId,
      challenge,
      sessionPubKey: session,
    },
    headers,
    expect: [201],
  });
  return res.data as unknown as EntitledResponse;
}

async function paidProvision(): Promise<EntitledResponse> {
  const session = bytesToHex(generateSessionKeypair().publicKey);
  const path = '/esim/provision?mb=300';
  const headers = { [SESSION_PUBKEY_HEADER]: session };
  const quote = await api.request(path, { headers, expect: [402] });
  const paid = await api.request(path, {
    headers: { ...headers, ...(await payHeaders(chain, 'human', quote.headers, session)) },
    expect: [201],
  });
  return paid.data as unknown as EntitledResponse;
}

const entry = (
  label: SeededEntitlement['label'],
  e: EntitledResponse,
  mbUsed: number,
): SeededEntitlement => ({
  label,
  key: e.entitlementKey,
  tier: e.tier,
  mbTotal: e.mbTotal,
  mbUsed,
  expiresAt: e.expiresAt,
  planUrl: `${webBase}/plan/${encodeURIComponent(e.entitlementKey)}`,
});

async function seed(): Promise<SeedState> {
  const runId = toHex(BigInt(Date.now())).slice(2);
  const txs: SeedState['txs'] = { claims: [], payments: [] };
  const campaignId = await campaignIdFor();
  const expiresAt = await fundCampaign(campaignId, txs);
  const auditKey = await registerCampaign(campaignId, expiresAt);
  if (auditKey !== undefined) writeFileSync(join(OUT, 'audit-key.txt'), `${auditKey}\n`);

  const orb = await freeClaim(campaignId, 'orb', `demo-human-orb-${runId}`);
  const doc = await freeClaim(campaignId, 'document', `demo-human-doc-${runId}`, {
    'x-seed-validity-s': '90',
  });
  const paid = await paidProvision();
  for (const e of [orb, doc]) if (e.claimTx) txs.claims.push(e.claimTx);
  if (paid.settlement?.transaction) txs.payments.push(paid.settlement.transaction);
  say(`entitled  orb      ${orb.tier} ${orb.mbTotal} MB  claim ${orb.claimTx ?? '—'}`);
  say(`entitled  document ${doc.tier} ${doc.mbTotal} MB  claim ${doc.claimTx ?? '—'} (90 s)`);
  say(
    `entitled  paid     ${paid.tier} ${paid.mbTotal} MB  x402 ${paid.settlement?.transaction ?? '—'}`,
  );

  const at = await api.now();
  const orbUsed = Math.round(orb.mbTotal * 0.6);
  const paidUsed = Math.round(paid.mbTotal * 0.82);
  await reportUsage(stack, {
    entitlementKey: orb.entitlementKey,
    usedMb: orbUsed,
    totalMb: orb.mbTotal,
    at,
  });
  await reportUsage(stack, {
    entitlementKey: paid.entitlementKey,
    usedMb: paidUsed,
    totalMb: paid.mbTotal,
    at,
  });
  const put = await agentPolicyPut(
    roleKey('human'),
    CHAIN_ID,
    paid.entitlementKey,
    AGENT_POLICY,
    at,
  );
  await api.request('/agent/policy', { method: 'PUT', body: put, expect: [200] });
  say(`usage     orb 60 % · paid 82 % (signed mock webhooks) · agent policy on the paid key`);

  const giftBody = { name: 'rahul.eth', mb: 1000 };
  const giftQuote = await api.request('/gift', { body: giftBody, expect: [402] });
  const gift = (
    await api.request('/gift', {
      body: giftBody,
      headers: await payHeaders(chain, 'stranger', giftQuote.headers),
      expect: [201],
    })
  ).data as unknown as GiftResponse;
  check(isValidPin(gift.pin), 'gift PIN is not Verhoeff-valid');
  if (gift.settlement.transaction) txs.payments.push(gift.settlement.transaction);
  writeFileSync(join(OUT, 'gift.json'), `${JSON.stringify(gift, null, 2)}\n`);
  say(
    `gift      rahul.eth → ${gift.to} · 1 GB · serial ${gift.serial} · x402 ${gift.settlement.transaction}`,
  );

  const cards: { serial: string; pin: string; mb: number; giftId: string }[] = [];
  for (let i = 0; i < CARD_COUNT; i += 1) {
    const card = (
      await api.request('/gift', {
        body: { name: 'card', mb: CARD_MB },
        headers: { 'x-seed-card-campaign': campaignId },
        expect: [201],
      })
    ).data as unknown as GiftResponse;
    check(isValidPin(card.pin), 'card PIN is not Verhoeff-valid');
    cards.push({ serial: card.serial, pin: card.pin, mb: CARD_MB, giftId: card.giftId });
  }
  writeFileSync(join(OUT, 'cards.json'), `${JSON.stringify(cards, null, 2)}\n`);
  say(`cards     ${CARD_COUNT} campaign-funded cards (${CARD_MB} MB) → .e2e/cards.json`);

  return {
    seededAt: new Date().toISOString(),
    apiUrl: stack.apiUrl,
    rpcUrl: stack.rpcUrl,
    chainId: CHAIN_ID,
    addresses: { ...deployed, sponsor },
    campaignId,
    txs,
    entitlements: [
      entry('orb', orb, orbUsed),
      entry('paid', paid, paidUsed),
      entry('document', doc, 0),
    ],
    gift: {
      giftId: gift.giftId,
      serial: gift.serial,
      name: gift.name,
      mb: gift.mb,
      claimBy: gift.claimBy,
    },
    cards: cards.map(({ serial, mb }) => ({ serial, mb })),
  };
}

/** Committed demo data: no PIN, no entitlement key, no audit key (ops-demo §12 bug 3). */
function writeFixtures(state: SeedState): void {
  mkdirSync(FIXTURES, { recursive: true });
  const write = (name: string, value: unknown) =>
    writeFileSync(join(FIXTURES, name), `${JSON.stringify(value, null, 2)}\n`);
  write('campaign.json', {
    source: 'demo-seed',
    id: state.campaignId,
    name: CAMPAIGN_NAME,
    sponsor: state.addresses.sponsor,
    network: `eip155:${CHAIN_ID}`,
    contract: state.addresses.dataDrop,
    budgetUsd6: BUDGET.toString(),
    pricePerClaimUsd6: PRICE_PER_CLAIM.toString(),
    claimsPerHour: CLAIMS_PER_HOUR,
    bundleMb: { orb: 300, document: 150, device: 0 },
    validityDays: 7,
    planId: 'in-300mb-7d',
  });
  write(
    'entitlements.json',
    state.entitlements.map(({ label, tier, mbTotal, mbUsed }) => ({
      label,
      tier,
      mbTotal,
      mbUsed,
    })),
  );
  write('gift.json', { name: state.gift.name, mb: state.gift.mb, serial: state.gift.serial });
  write('cards.json', state.cards);
  write('agent-policy.json', AGENT_POLICY);
}

function print(state: SeedState, reused: boolean): void {
  say('');
  say(
    `${reused ? 'reused' : 'seeded'} · campaign ${state.campaignId} · ${state.addresses.dataDrop}`,
  );
  for (const e of state.entitlements) {
    say(`  ${e.label.padEnd(8)} ${String(e.mbTotal - e.mbUsed).padStart(4)} MB left  ${e.planUrl}`);
  }
  say(`  gift     ${state.gift.name} ${state.gift.mb} MB  ${webBase}/card/${state.gift.serial}`);
  say(`  cards    ${state.cards.length} × ${CARD_MB} MB  (PINs in .e2e/cards.json, local only)`);
  say(`seed: ${Math.round(performance.now() - started)} ms`);
}

mkdirSync(OUT, { recursive: true });
const statePath = join(OUT, 'state.json');
if (flags.reset) {
  for (const f of SEED_FILES) rmSync(join(OUT, f), { force: true });
} else if (existsSync(statePath)) {
  const previous = JSON.parse(readFileSync(statePath, 'utf8')) as SeedState;
  if (previous.apiUrl === stack.apiUrl && (await stillLive(previous))) {
    print(previous, true);
    process.exit(0);
  }
}
const state = await seed();
writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
writeFileSync(
  join(OUT, 'keys.json'),
  `${JSON.stringify(Object.fromEntries(state.entitlements.map((e) => [e.label, e.key])), null, 2)}\n`,
);
if (flags.fixtures) writeFixtures(state);
print(state, false);
