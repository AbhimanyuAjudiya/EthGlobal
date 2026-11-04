/**
 * Before the suite: make sure the real local stack has a live sponsor campaign (registered exactly like the
 * sponsor console does — approve + DataDrop.createCampaign from the sponsor's key, then POST /sponsor signed with
 * SponsorLogin) and seed three campaign-funded scratch cards through the API's local-only seed hook. The PINs go to
 * the server-side PRINT_CARDS_FILE (never a public route) and to the suite's state file under .e2e/ (git-ignored).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';

import DataDropAbi from '@ethglobal/contracts/abi/DataDrop.json' with { type: 'json' };
import anvil from '@ethglobal/contracts/addresses/anvil.json' with { type: 'json' };
import { httpJson } from '@ethglobal/protocol/http';
import { rechargeDomain, SPONSOR_LOGIN_TYPES } from '@ethglobal/protocol/typed-data';

import { ANVIL_MNEMONIC, API_URL, PRINT_CARDS_FILE, RPC_URL, STATE_FILE } from './env';

const ERC20 = parseAbi(['function approve(address spender, uint256 amount) returns (bool)']);
const DAY_S = 86_400n;

export interface E2eState {
  campaignId: Hex;
  campaignName: string;
  cards: { serial: string; pin: string; mb: number }[];
}

async function waitForApi(): Promise<void> {
  for (let i = 0; i < 120; i += 1) {
    try {
      const { data } = await httpJson<{ chainId?: number }>(`${API_URL}/healthz`, {
        timeoutMs: 2_000,
      });
      if (data.chainId === 31337) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`the local API at ${API_URL} is not answering (run scripts/e2e-local.sh --web)`);
}

export default async function globalSetup(): Promise<void> {
  await waitForApi();
  const sponsor = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: 3 });
  const reader = createPublicClient({ chain: foundry, transport: http(RPC_URL) });
  const wallet = createWalletClient({ account: sponsor, chain: foundry, transport: http(RPC_URL) });
  const block = await reader.getBlock();
  const budget = 1_000_000_000n; // 1,000 USDC
  const id =
    `0x${sponsor.address.slice(2).toLowerCase()}00000000${BigInt(Date.now()).toString(16).padStart(16, '0')}` as Hex;
  await reader.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: anvil.usdc as Address,
      abi: ERC20,
      functionName: 'approve',
      args: [anvil.dataDrop as Address, budget],
    }),
  });
  const expiresAtS = block.timestamp + 30n * DAY_S;
  await reader.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: anvil.dataDrop as Address,
      abi: DataDropAbi as Abi,
      functionName: 'createCampaign',
      args: [id, budget, 500_000n, 120, expiresAtS],
    }),
  });
  const issuedAt = Math.max(Date.now(), Number((await reader.getBlock()).timestamp) * 1000);
  const signature = await sponsor.signTypedData({
    domain: rechargeDomain(31337),
    types: SPONSOR_LOGIN_TYPES,
    primaryType: 'SponsorLogin',
    message: { campaignId: id, sponsor: sponsor.address, issuedAt: BigInt(issuedAt) },
  });
  const campaignName = 'Hedera';
  await httpJson(`${API_URL}/sponsor`, {
    body: {
      campaign: {
        id,
        sponsor: sponsor.address,
        name: campaignName,
        bundleMb: { orb: 300, document: 150, device: 0 },
        pricePerClaimUsd6: '500000',
        maxClaims: 2000,
        claimsPerHour: 120,
        validityDays: 7,
        wholesaleUsd6PerGb: '1140000',
        idResaleUsd6: '500000',
        planId: 'in-300mb-7d',
        network: 'eip155:31337',
        contract: anvil.dataDrop,
        expiresAt: Number(expiresAtS) * 1000,
      },
      auth: { issuedAt, signature },
    },
    headers: { 'x-forwarded-for': '198.18.0.1' },
  });

  const cards: E2eState['cards'] = [];
  for (let i = 0; i < 3; i += 1) {
    const { data } = await httpJson<{ serial: string; pin: string; mb: number }>(
      `${API_URL}/gift`,
      {
        body: { name: 'card', mb: 300 },
        headers: { 'x-seed-card-campaign': id, 'x-forwarded-for': `198.18.0.${10 + i}` },
      },
    );
    cards.push({ serial: data.serial, pin: data.pin, mb: data.mb });
  }
  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const state: E2eState = { campaignId: id, campaignName, cards };
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(
    PRINT_CARDS_FILE,
    `${JSON.stringify(
      cards.map((c) => ({ ...c, sponsor: campaignName })),
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
}
