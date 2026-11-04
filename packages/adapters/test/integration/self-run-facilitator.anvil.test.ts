/**
 * SelfRunFacilitator end to end on a local Anvil with the deployed MockUSDC3009 (packages/contracts):
 *   pnpm dev:chain &   # scripts/dev-chain.sh — Anvil 31337 + Deploy.s.sol → deploy/addresses.anvil.json
 *   ANVIL_RPC_URL=http://127.0.0.1:8545 pnpm --filter @ethglobal/adapters exec vitest run test/integration
 * Skipped when ANVIL_RPC_URL is unset (CI without Foundry).
 */
import { readFileSync } from 'node:fs';

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  createViemRelayer,
  domainFromRequirements,
  encodeTransferWithAuthorization,
  fromPaymentAuthorization,
  readDomain,
  TOKEN_READ_ABI,
  typedDataTransferWithAuthorization,
} from '@ethglobal/eip3009';

import { SelfRunFacilitator } from '../../src/live/self-run-facilitator.js';
import {
  anvilAccounts,
  anvilKeys,
  anvilRoles,
  paymentPayload,
  requirementInput,
} from '../../src/testing/index.js';

import type { PaymentPayload, PaymentRequirements } from '../../src/types.js';

const RPC = process.env.ANVIL_RPC_URL;
const addresses = (): { usdc: Address } =>
  JSON.parse(
    readFileSync(
      new URL('../../../contracts/deploy/addresses.anvil.json', import.meta.url),
      'utf8',
    ),
  ) as { usdc: Address };

describe.skipIf(!RPC)('SelfRunFacilitator on Anvil + MockUSDC3009', () => {
  let publicClient: PublicClient;
  let usdc: Address;
  let chainNow: () => number;
  const human = privateKeyToAccount(anvilKeys[anvilRoles.human]);
  const stranger = privateKeyToAccount(anvilKeys[anvilRoles.stranger]);
  const relayerAccount = privateKeyToAccount(anvilKeys[anvilRoles.relayer]);
  const PAYOUT = anvilAccounts[anvilRoles.payout];
  const wallet = (account: typeof human) =>
    createWalletClient({ chain: foundry, transport: http(RPC), account });

  beforeAll(async () => {
    publicClient = createPublicClient({ chain: foundry, transport: http(RPC) });
    usdc = addresses().usdc;
    let offset = 0;
    const block = await publicClient.getBlock();
    offset = Number(block.timestamp) * 1000 - Date.now();
    chainNow = () => Date.now() + offset; // the facilitator's clock follows block time (strict validAfter < now)
  });

  const facilitator = () =>
    new SelfRunFacilitator({
      publicClient,
      relayer: createViemRelayer({
        walletClient: wallet(relayerAccount),
        publicClient,
        simulate: true,
      }),
      token: usdc,
      chainId: 31337,
      network: 'eip155:31337',
      now: chainNow,
      perFromRateLimit: 50,
    });

  async function pay(
    rail: SelfRunFacilitator,
    signer = human,
    value = '400000',
  ): Promise<{ payload: PaymentPayload; requirements: PaymentRequirements }> {
    const requirements = rail.createPaymentRequirement(
      requirementInput({ asset: usdc, amount: value }),
    ).accepts[0]!;
    const nowS = Math.floor(chainNow() / 1000);
    const draft = paymentPayload(requirements, {
      from: signer.address,
      nonce: `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`,
      validAfter: String(nowS - 30),
      validBefore: String(nowS + 300),
    });
    if (!('authorization' in draft.payload)) throw new Error('evm');
    const signature = await signer.signTypedData(
      typedDataTransferWithAuthorization(
        domainFromRequirements(requirements),
        fromPaymentAuthorization(draft.payload.authorization),
      ),
    );
    return { payload: { ...draft, payload: { ...draft.payload, signature } }, requirements };
  }

  const balance = (who: Address) =>
    publicClient.readContract({
      address: usdc,
      abi: TOKEN_READ_ABI,
      functionName: 'balanceOf',
      args: [who],
    });

  it('readDomain reads ERC-5267 from the deployed token ("USD Coin", "2", 31337)', async () => {
    await expect(readDomain(publicClient, usdc)).resolves.toEqual({
      name: 'USD Coin',
      version: '2',
      chainId: 31337,
    });
  });

  it('verify then settle moves exactly the amount to payTo and burns the nonce', async () => {
    const rail = facilitator();
    const { payload, requirements } = await pay(rail);
    await expect(rail.verify(payload, requirements)).resolves.toEqual({
      isValid: true,
      payer: human.address,
    });
    const before = await balance(PAYOUT);
    const settled = await rail.settle(payload, requirements);
    expect(settled).toMatchObject({ success: true, network: 'eip155:31337', payer: human.address });
    expect(await balance(PAYOUT)).toBe(before + 400_000n);
    await expect(rail.verify(payload, requirements)).resolves.toMatchObject({
      isValid: false,
      invalidReason: 'nonce_already_used',
    });
    // re-settle is idempotent: the same transaction, no second transfer
    await expect(rail.settle(payload, requirements)).resolves.toMatchObject({
      success: true,
      transaction: settled.success && settled.transaction,
    });
    expect(await balance(PAYOUT)).toBe(before + 400_000n);
  });

  it('front-run (A15, T-15): a stranger submits the authorization first ⇒ settle succeeds with the stranger tx', async () => {
    const rail = facilitator();
    const { payload, requirements } = await pay(rail);
    if (!('authorization' in payload.payload)) throw new Error('evm');
    const data = encodeTransferWithAuthorization(
      fromPaymentAuthorization(payload.payload.authorization),
      payload.payload.signature as Hex,
    );
    const front = await wallet(stranger).sendTransaction({ to: usdc, data });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: front });
    expect(receipt.status).toBe('success');
    await expect(rail.settle(payload, requirements)).resolves.toEqual({
      success: true,
      transaction: front,
      network: 'eip155:31337',
      payer: human.address,
    });
  });

  it('an unfunded payer and a wrong signer never cost the relayer a transaction (T-16)', async () => {
    const rail = facilitator();
    const nonceBefore = await publicClient.getTransactionCount({ address: relayerAccount.address });
    const broke = privateKeyToAccount(`0x${'77'.repeat(32)}`);
    const unfunded = await pay(rail, broke);
    await expect(rail.settle(unfunded.payload, unfunded.requirements)).resolves.toMatchObject({
      success: false,
      errorReason: 'insufficient_funds',
    });
    const forged = await pay(rail);
    const wrong = await pay(rail, stranger);
    const mixed = {
      ...forged.payload,
      payload: {
        ...forged.payload.payload,
        signature: (wrong.payload.payload as { signature: Hex }).signature,
      },
    } as PaymentPayload;
    await expect(rail.settle(mixed, forged.requirements)).resolves.toMatchObject({
      success: false,
      errorReason: 'invalid_signature',
    });
    expect(await publicClient.getTransactionCount({ address: relayerAccount.address })).toBe(
      nonceBefore,
    );
  });
});
