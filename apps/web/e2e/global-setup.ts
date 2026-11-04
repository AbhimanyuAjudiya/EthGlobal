/**
 * Before the suite: make sure the real local stack has a live sponsor campaign (registered exactly like the
 * sponsor console does — approve + DataDrop.createCampaign from the sponsor's key, then POST /sponsor signed with
 * SponsorLogin) and seed three campaign-funded scratch cards through the API's local-only seed hook. The PINs go to
 * the server-side PRINT_CARDS_FILE (never a public route) and to the suite's state file under .e2e/ (git-ignored).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { httpJson } from '@ethglobal/protocol/http';

import { API_URL, PRINT_CARDS_FILE, STATE_FILE } from './env';
import { registerCampaign } from './seed-campaign';

import type { Hex } from 'viem';

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
  const campaignName = 'Hedera';
  const id = await registerCampaign({
    name: campaignName,
    budget: 1_000_000_000n, // 1,000 USDC
    maxClaims: 2000,
    expiresInDays: 30,
    salt: BigInt(Date.now()),
    clientIp: '198.18.0.1',
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
