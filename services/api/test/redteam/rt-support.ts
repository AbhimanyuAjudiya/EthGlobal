/** Shared red-team helpers (not a test file): a throwaway Anvil with DataDrop + MockUSDC3009, and a fake live env. */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';

import { anvilAccounts, anvilKeys, anvilRoles } from '@ethglobal/adapters/testing';

import { LIVE_ENV } from '../support/live-env.js';

const contractsOut = new URL('../../../../packages/contracts/out/', import.meta.url);
const ANVIL = [`${process.env.HOME ?? ''}/.foundry/bin/anvil`, '/usr/local/bin/anvil'].filter((p) =>
  existsSync(p),
)[0];
export const anvilReady =
  ANVIL !== undefined && existsSync(new URL('DataDrop.sol/DataDrop.json', contractsOut));

export const abiOf = (contract: 'DataDrop' | 'MockUSDC3009'): { abi: Abi; bytecode: Hex } => {
  const json = JSON.parse(
    readFileSync(new URL(`${contract}.sol/${contract}.json`, contractsOut), 'utf8'),
  ) as { abi: Abi; bytecode: { object: Hex } };
  return { abi: json.abi, bytecode: json.bytecode.object };
};

export interface Chain {
  rpc: string;
  usdc: Address;
  dataDrop: Address;
  now(): Promise<number>;
  call(
    from: Hex,
    to: Address,
    contract: 'DataDrop' | 'MockUSDC3009',
    fn: string,
    args: unknown[],
  ): Promise<void>;
  read<T>(
    to: Address,
    contract: 'DataDrop' | 'MockUSDC3009',
    fn: string,
    args: unknown[],
  ): Promise<T>;
  stop(): void;
}

/** Starts Anvil on a random port, deploys MockUSDC3009 + DataDrop (owner #0, payout #1, attestor #2), funds roles. */
export async function startChain(): Promise<Chain> {
  const port = 20_000 + Math.floor(Math.random() * 5_000);
  const rpc = `http://127.0.0.1:${port}`;
  const proc: ChildProcess = spawn(
    ANVIL!,
    ['--silent', '--chain-id', '31337', '--port', `${port}`],
    {
      stdio: 'ignore',
    },
  );
  const reader = createPublicClient({ chain: foundry, transport: http(rpc), pollingInterval: 50 });
  for (let tries = 0; tries < 100 && !(await reader.getChainId().catch(() => 0)); tries++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  const signer = (key: Hex) =>
    createWalletClient({ account: privateKeyToAccount(key), chain: foundry, transport: http(rpc) });
  const mined = (hash: Hex) => reader.waitForTransactionReceipt({ hash });
  const create = async (contract: 'DataDrop' | 'MockUSDC3009', args: unknown[]) => {
    const { abi, bytecode } = abiOf(contract);
    const receipt = await mined(await signer(anvilKeys[0]).deployContract({ abi, bytecode, args }));
    return receipt.contractAddress!;
  };
  const usdc = await create('MockUSDC3009', []);
  const dataDrop = await create('DataDrop', [
    usdc,
    anvilAccounts[1],
    anvilAccounts[2],
    anvilAccounts[0],
  ]);
  const chain: Chain = {
    rpc,
    usdc,
    dataDrop,
    now: async () => Number((await reader.getBlock()).timestamp),
    call: async (from, to, contract, functionName, args) => {
      await mined(
        await signer(from).writeContract({
          address: to,
          abi: abiOf(contract).abi,
          functionName,
          args,
        }),
      );
    },
    read: async <T>(
      to: Address,
      contract: 'DataDrop' | 'MockUSDC3009',
      functionName: string,
      args: unknown[],
    ) =>
      (await reader.readContract({
        address: to,
        abi: abiOf(contract).abi,
        functionName,
        args,
      })) as T,
    stop: () => void proc.kill(),
  };
  for (const role of [anvilRoles.sponsor, anvilRoles.human, anvilRoles.stranger] as const)
    await chain.call(anvilKeys[0], usdc, 'MockUSDC3009', 'mint', [
      anvilAccounts[role],
      1_000_000_000n,
    ]);
  return chain;
}

/** A complete MODE=live env for an in-process boot over a fake fetch (no network is touched). */
export const fakeLiveEnv = (extra: Record<string, string> = {}): Record<string, string> =>
  Object.assign(
    {},
    LIVE_ENV,
    Object.fromEntries([
      ['CHAIN', '84532'],
      ['RPC_URL', 'https://sepolia.base.org'],
      ['DATADROP_ADDRESS', '0x90193C961A926261B756D1E5bb255e67ff9498A1'],
      ['HEDERA_ACCOUNT_ID', '0.0.5005'],
      ['HEDERA_PRIVATE_KEY', `0x${'31'.repeat(32)}`],
      ['HCS_TOPIC_ID', '0.0.6006'],
      ['ENS_RPC_URL', 'https://eth.example'],
      ['ESIMACCESS_ACCESS_CODE', 'access-code-0123456789'],
      ['RESELLER_FALLBACK', 'none'],
    ]),
    extra,
  );
