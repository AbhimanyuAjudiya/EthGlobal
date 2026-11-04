/** A throwaway Anvil with DataDrop + MockUSDC3009 deployed and the roles funded (shared by the Anvil-backed tests). */
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

const contractsOut = new URL('../../../../packages/contracts/out/', import.meta.url);
const ANVIL = [`${process.env.HOME ?? ''}/.foundry/bin/anvil`, '/usr/local/bin/anvil'].find((p) =>
  existsSync(p),
);
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
  /** The mined status of a transaction (e.g. a settlement). */
  status(hash: Hex): Promise<'success' | 'reverted'>;
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
    status: async (hash) => (await reader.getTransactionReceipt({ hash })).status,
    stop: () => void proc.kill(),
  };
  for (const role of [anvilRoles.sponsor, anvilRoles.human, anvilRoles.stranger] as const)
    await chain.call(anvilKeys[0], usdc, 'MockUSDC3009', 'mint', [
      anvilAccounts[role],
      1_000_000_000n,
    ]);
  return chain;
}
