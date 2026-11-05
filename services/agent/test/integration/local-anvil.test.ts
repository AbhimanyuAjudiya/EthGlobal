/**
 * Integration (MODE=local, real chain): Anvil + the deployed MockUSDC3009, the agent CLI (`main(['--once'])` — the
 * exact code path `pnpm --filter @ethglobal/agent start` runs: API reads, Anvil #4 EVM payer, real fetch over TCP),
 * against a server speaking the INTERFACES §7 contract that settles the EIP-3009 authorization on-chain through a
 * relayer (`@ethglobal/eip3009` calldata + createViemRelayer). Skipped when Foundry's `anvil` is not installed.
 *
 * Against services/api: the same CLI path runs against the real API process (Anvil + Deploy.s.sol + the self-run
 * facilitator) in `scripts/e2e-agent.ts`, step I-10 of `scripts/e2e-local.sh`. The in-process swap of the fixture
 * below for the API's `createApp(...)` is not possible from this file: the eslint zone "services never import each
 * other" bans `@ethglobal/api` and `../../../api/src/**` here, so this test keeps the §7-contract fixture.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { serve, type ServerType } from '@hono/node-server';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { InMemoryLedger, MockConsensusLog, type PaymentRail } from '@ethglobal/adapters';
import { anvilAccounts, anvilKeys, anvilRoles } from '@ethglobal/adapters/testing';
import {
  createViemRelayer,
  EIP3009_ABI,
  encodeTransferWithAuthorization,
  fromPaymentAuthorization,
  TOKEN_READ_ABI,
} from '@ethglobal/eip3009';
import { httpJson } from '@ethglobal/protocol/http';
import { isEvmExact } from '@ethglobal/protocol/schemas';

import { main } from '../../src/cli.js';
import { Journal } from '../../src/journal.js';
import { memoryLog } from '../../src/log.js';
import { createFakeApi } from '../fake-api.js';
import { KEY, seed, setUsage, tempDir } from '../helpers.js';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const ARTIFACT = join(ROOT, 'packages/contracts/out/MockUSDC3009.sol/MockUSDC3009.json');
const hasAnvil = spawnSync('anvil', ['--version']).status === 0 && existsSync(ARTIFACT);
const PORT = 20_000 + Math.floor(Math.random() * 20_000);
const RPC = `http://127.0.0.1:${PORT}`;
const chain = defineChain({
  id: 31337,
  name: 'anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const PAYOUT = anvilAccounts[anvilRoles.payout];
const AGENT = anvilAccounts[anvilRoles.agent];

/** Settles exact-EVM payloads on Anvil with `transferWithAuthorization` from the relayer (Anvil #6). */
function anvilRail(publicClient: PublicClient, token: Address): PaymentRail {
  const relayer = createViemRelayer({
    walletClient: createWalletClient({
      chain,
      transport: http(RPC),
      account: privateKeyToAccount(anvilKeys[anvilRoles.relayer] as Hex),
    }),
    publicClient,
    simulate: true,
  });
  return {
    createPaymentRequirement: () => {
      throw new Error('unused');
    },
    verify: async () => ({ isValid: true, payer: AGENT }),
    settle: async (payload, req) => {
      if (!isEvmExact(payload.payload))
        return { success: false, errorReason: 'unsupported_scheme', network: req.network };
      const auth = fromPaymentAuthorization(payload.payload.authorization);
      const r = await relayer.submit(
        token,
        encodeTransferWithAuthorization(auth, payload.payload.signature as Hex),
      );
      return r.status === 'success'
        ? { success: true, transaction: r.hash, network: req.network, payer: auth.from }
        : { success: false, errorReason: 'transaction_reverted', network: req.network };
    },
  };
}

describe.skipIf(!hasAnvil)(
  'integration: agent CLI against the §7 contract on Anvil (MODE=local)',
  () => {
    let anvil: ChildProcess;
    let server: ServerType;
    let publicClient: PublicClient;
    let usdc: Address;
    let apiUrl: string;
    const ledger = new InMemoryLedger({ now: Date.now });
    const consensus = new MockConsensusLog({ now: Date.now });
    const balance = (who: Address) =>
      publicClient.readContract({
        address: usdc,
        abi: TOKEN_READ_ABI,
        functionName: 'balanceOf',
        args: [who],
      });

    beforeAll(async () => {
      anvil = spawn('anvil', ['--chain-id', '31337', '--port', String(PORT), '--silent'], {
        stdio: 'ignore',
      });
      publicClient = createPublicClient({ chain, transport: http(RPC) });
      for (let i = 0; i < 100; i += 1) {
        if (
          await publicClient.getChainId().then(
            () => true,
            () => false,
          )
        )
          break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8')) as {
        abi: unknown[];
        bytecode: { object: Hex };
      };
      const deployer = createWalletClient({
        chain,
        transport: http(RPC),
        account: privateKeyToAccount(anvilKeys[anvilRoles.deployer] as Hex),
      });
      const hash = await deployer.deployContract({
        abi: artifact.abi,
        bytecode: artifact.bytecode.object,
      });
      usdc = (await publicClient.waitForTransactionReceipt({ hash })).contractAddress!;
      const mint = await deployer.writeContract({
        address: usdc,
        abi: [
          {
            type: 'function',
            name: 'mint',
            stateMutability: 'nonpayable',
            inputs: [
              { name: 'to', type: 'address' },
              { name: 'amount', type: 'uint256' },
            ],
            outputs: [],
          },
        ],
        functionName: 'mint',
        args: [AGENT, 10_000_000n],
      });
      await publicClient.waitForTransactionReceipt({ hash: mint });

      // the real services/api runs this path in scripts/e2e-agent.ts (I-10); see the header
      const app = createFakeApi({
        ledger,
        now: Date.now,
        accepts: [
          {
            scheme: 'exact',
            network: 'eip155:31337',
            asset: usdc,
            payTo: PAYOUT,
            maxTimeoutSeconds: 300,
            extra: { name: 'USD Coin', version: '2' },
          },
        ],
        rail: anvilRail(publicClient, usdc),
      }).app;
      await new Promise<void>((resolve) => {
        server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
          apiUrl = `http://127.0.0.1:${info.port}`;
          resolve();
        });
      });
    }, 60_000);

    afterAll(() => {
      server?.close();
      anvil?.kill();
    });

    const env = async () => ({
      MODE: 'local',
      AGENT_API_URL: apiUrl,
      AGENT_EVM_RPC_URL: RPC,
      AGENT_WATCH_KEYS: KEY,
      AGENT_PAYTO_ALLOWLIST: `eip155:31337|${usdc}|${PAYOUT}`,
      AGENT_STATE_DIR: await tempDir(),
    });

    it('below threshold: exactly one real purchase — USDC moved on Anvil, HCS receipt with the UAID, /me shows +100 MB', async () => {
      await seed(ledger, Date.now, { mbTotal: 1000, mbUsed: 850 });
      const before = await balance(PAYOUT);
      const log = memoryLog();
      expect(await main(['--once'], await env(), { consensus, log })).toBe(0);
      expect((await balance(PAYOUT)) - before).toBe(400_000n);

      const [message] = consensus
        .messages('0.0.1001')
        .map((m) => JSON.parse(m) as Record<string, string>);
      expect(message).toMatchObject({
        t: 'agent-topup',
        svc: 'agent',
        network: 'eip155:31337',
        usd6: '400000',
        mb: 100,
      });
      expect(message?.uaid).toMatch(/^uaid:aid:.*nativeId=hedera:testnet:0\.0\.0$/);
      const receipt = await publicClient.getTransactionReceipt({ hash: message!.tx as Hex });
      expect(receipt.status).toBe('success');
      const logs = await publicClient.getContractEvents({
        address: usdc,
        abi: EIP3009_ABI,
        eventName: 'AuthorizationUsed',
        fromBlock: receipt.blockNumber,
        toBlock: receipt.blockNumber,
      });
      expect(logs).toHaveLength(1);

      const { data: me } = await httpJson<{ mbTotal: number }>(
        `${apiUrl}/me/${encodeURIComponent(KEY)}`,
      );
      expect(me.mbTotal).toBe(1100);
    }, 60_000);

    it('above threshold: zero purchases', async () => {
      const before = await balance(PAYOUT);
      expect(await main(['--once'], await env(), { consensus, log: memoryLog() })).toBe(0);
      expect(await balance(PAYOUT)).toBe(before);
      expect(consensus.messages('0.0.1001')).toHaveLength(1);
    });

    it('AGENT_DRY_RUN=1: zero purchases and the decision is journaled', async () => {
      await setUsage(ledger, Date.now, 1100);
      const e = { ...(await env()), AGENT_DRY_RUN: '1' };
      const before = await balance(PAYOUT);
      expect(await main(['--once'], e, { consensus, log: memoryLog() })).toBe(0);
      expect(await balance(PAYOUT)).toBe(before);
      const journal = await new Journal(e.AGENT_STATE_DIR).read();
      expect(journal.some((l) => l.event === 'would-buy')).toBe(true);
    });
  },
);
