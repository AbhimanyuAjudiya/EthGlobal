/**
 * Test-only glue shared by every TypeScript script (ops-demo §1 `scripts/lib/clients.ts`): one API client over
 * `httpJson`, viem clients for the Anvil roles, the deployed addresses, and the x402 / webhook helpers a wallet and a
 * reseller would use. No business logic: wallets sign through `services/api/test/support/client.ts` (the one signer
 * the in-process tests and `e2e-flow.ts` use), webhooks through `MockReseller.signedWebhook`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';

import { DEFAULT_MOCK_WEBHOOK_SECRET, MockReseller } from '@ethglobal/adapters';
import { anvilKeys, anvilRoles } from '@ethglobal/adapters/testing';
import DataDropAbi from '@ethglobal/contracts/abi/DataDrop.json' with { type: 'json' };
import UsdcAbi from '@ethglobal/contracts/abi/MockUSDC3009.json' with { type: 'json' };
import { httpJson } from '@ethglobal/protocol/http';
import type { ChallengeWire } from '@ethglobal/protocol/schemas';
import { decodePaymentRequired, PAYMENT_SIGNATURE_HEADER } from '@ethglobal/protocol/x402';

import { paymentHeader } from '../../services/api/test/support/client.js';

export const CHAIN_ID = 31337;
export const dataDropAbi = DataDropAbi as Abi;
export const usdcAbi = UsdcAbi as Abi;

export type Role = keyof typeof anvilRoles;
/** The public Anvil key that plays `role` locally (adapters/testing; never funded anywhere else). */
export const roleKey = (role: Role): Hex => anvilKeys[anvilRoles[role]];
export const roleAddress = (role: Role): Address => privateKeyToAccount(roleKey(role)).address;

export interface Stack {
  apiUrl: string;
  rpcUrl: string;
}

export const stackFromEnv = (env: NodeJS.ProcessEnv = process.env): Stack => ({
  apiUrl: env.API_URL ?? 'http://127.0.0.1:8787',
  rpcUrl: env.RPC_URL ?? env.ANVIL_RPC_URL ?? 'http://127.0.0.1:8545',
});

export interface AnvilAddresses {
  dataDrop: Address;
  usdc: Address;
  payout: Address;
}

/** deploy/addresses.anvil.json, written by scripts/dev-chain.sh (the API reads the same file). */
export function anvilAddresses(): AnvilAddresses {
  const file = fileURLToPath(import.meta.resolve('@ethglobal/contracts/addresses/anvil.json'));
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as AnvilAddresses;
  } catch {
    throw new Error(`${file} missing: start the chain first (pnpm dev:chain)`);
  }
}

export const publicClientFor = (stack: Stack): PublicClient =>
  createPublicClient({ chain: foundry, pollingInterval: 200, transport: http(stack.rpcUrl) });

export const walletFor = (stack: Stack, role: Role) =>
  createWalletClient({
    chain: foundry,
    account: privateKeyToAccount(roleKey(role)),
    transport: http(stack.rpcUrl),
  });

export const usdcBalance = (client: PublicClient, token: Address, who: Address) =>
  client.readContract({
    address: token,
    abi: usdcAbi,
    functionName: 'balanceOf',
    args: [who],
  }) as Promise<bigint>;

export interface ApiReply {
  status: number;
  headers: Headers;
  data: Record<string, unknown>;
}

const EVERY_STATUS = [200, 201, 202, 204, 400, 401, 402, 404, 409, 410, 423, 429, 503];

/**
 * One API client per script run. The API runs with TRUST_PROXY=1 locally, so each request carries its own
 * documentation-range X-Forwarded-For and the per-IP limits (10 challenges/min, 5 claims/min) stay out of the seed's way.
 */
export function apiClient(stack: Stack) {
  let n = 0;
  async function request(
    path: string,
    init: {
      method?: 'GET' | 'POST' | 'PUT';
      body?: unknown;
      headers?: Record<string, string>;
      expect?: number[];
    } = {},
  ): Promise<ApiReply> {
    n += 1;
    const method = init.method ?? (init.body === undefined ? 'GET' : 'POST');
    const reply = await httpJson(`${stack.apiUrl}${path}`, {
      method,
      headers: { 'x-forwarded-for': `198.51.100.${(n % 250) + 1}`, ...init.headers },
      ...(init.body === undefined ? {} : { body: init.body }),
      allowStatus: EVERY_STATUS,
      timeoutMs: 30_000,
    });
    if (init.expect && !init.expect.includes(reply.status)) {
      throw new Error(`${method} ${path} → ${reply.status} ${JSON.stringify(reply.data)}`);
    }
    return { ...reply, data: (reply.data ?? {}) as Record<string, unknown> };
  }

  return {
    request,
    challenge: async (path: string, sessionPubKey: Hex) =>
      (
        await request('/challenge', {
          body: { audience: 'recharge', path, sessionPubKey },
          expect: [200],
        })
      ).data as unknown as ChallengeWire,
    /** The API's clock (MODE=local exposes it through POST /__local/clock with a zero advance). */
    now: async () =>
      Number((await request('/__local/clock', { body: { advanceMs: 0 }, expect: [200] })).data.now),
  };
}

export type ApiClient = ReturnType<typeof apiClient>;

/** Answers a 402: an EIP-3009 authorization by `role` over accepts[0], valid from the chain's clock. */
export async function payHeaders(
  client: PublicClient,
  role: Role,
  quote: Headers,
  sessionPubKey?: Hex,
): Promise<Record<string, string>> {
  const required = decodePaymentRequired(quote.get('PAYMENT-REQUIRED') ?? '');
  const accept = required.accepts[0];
  if (!accept) throw new Error('402 without accepts[]');
  const block = await client.getBlock();
  const header = await paymentHeader(roleKey(role), accept, {
    now: Number(block.timestamp) * 1000,
    ...(sessionPubKey === undefined ? {} : { sessionPubKey }),
  });
  return { [PAYMENT_SIGNATURE_HEADER]: header };
}

/** The ICCID the API's MockReseller assigned to `entitlementKey` (deterministic: same idempotency key ⇒ same line). */
export const mockIccid = async (entitlementKey: string): Promise<string> =>
  (await new MockReseller().order('in-300mb-7d', { idempotencyKey: entitlementKey })).iccid;

/** A signed mock-reseller usage webhook (what the reseller would POST), delivered to the API; expects 204. */
export async function reportUsage(
  stack: Stack,
  opts: { entitlementKey: string; usedMb: number; totalMb: number; at: number },
): Promise<void> {
  const iccid = await mockIccid(opts.entitlementKey);
  const delivery = new MockReseller({ webhookSecret: DEFAULT_MOCK_WEBHOOK_SECRET }).signedWebhook(
    [
      {
        provider: 'mock',
        eventId: `seed-${iccid}-${opts.usedMb}-${opts.at}`,
        iccid,
        usedMb: opts.usedMb,
        totalMb: opts.totalMb,
        asOf: opts.at,
      },
    ],
    opts.at,
  );
  await httpJson(`${stack.apiUrl}/webhooks/reseller/mock`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...delivery.headers },
    rawBody: delivery.body,
    allowStatus: [204],
  });
}

export function check(ok: unknown, what: string): asserts ok {
  if (!ok) throw new Error(what);
}
