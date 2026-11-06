/**
 * EnsCampaigns (ens/README.md, ens/SPIKE.md): one ENSv2 name per sponsor campaign on Sepolia. The API key is the
 * registrar of `<parent>`'s UserRegistry (ROLE_REGISTRAR | ROLE_RENEW and their admins); per campaign it
 *   1. deploys a PermissionedResolver proxy through the VerifiableFactory (salt = keccak256(campaignId)) whose
 *      `initialize` grants the API its resolver roles and writes every Recharge record in the same transaction,
 *   2. registers `<slug>` to the sponsor with role bitmap 0 (no ROLE_CAN_TRANSFER_ADMIN ⇒ non-transferable),
 *      that resolver and the campaign's expiry,
 *   3. grants the sponsor ROLE_SET_TEXT on ENS_SPONSOR_TEXT_KEYS only (`grantSetterRoles`, batched in `multicall`).
 * Every step first reads whether it is already done, so a run after a crash sends nothing twice. Transactions go
 * one at a time with our own nonce (load-balanced public RPCs hand out stale `pending` counts) and each waits for
 * its receipt before the next step.
 */
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  labelhash,
  parseAbi,
  toBytes,
  toHex,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { packetToBytes } from 'viem/ens';

import { ENS_SLUG_PATTERN, ENS_SPONSOR_TEXT_KEYS } from '@ethglobal/protocol/ids';

import { AdapterError } from '../errors.js';

import type {
  CampaignNameInput,
  CampaignNameResult,
  CampaignNames,
  CampaignNameStep,
} from '../types.js';

/** ENSv2 Sepolia, contracts-v2 @07e55a0 (the docs' deployment set; ens/SPIKE.md). */
export const ENS_SEPOLIA = {
  verifiableFactory: '0xda70306c98e97ece36f997a21368e53298572991',
  permissionedResolverImpl: '0x115eb53f0c60696633855f90b138178fb40b2b2c',
} as const;

const ROLE_SET_TEXT = 1n << 4n;
/** The API's root roles on each campaign resolver: SET_ADDRESS|SET_TEXT|SET_CONTENTHASH|SET_DATA|LINK + their admins. */
export const API_RESOLVER_ROLES = 0x11000111n | (0x11000111n << 128n);
/** IPermissionedRegistry.Status */
const AVAILABLE = 0;
const REGISTERED = 2;
const RECEIPT_TIMEOUT_MS = 180_000;

export const FACTORY_ABI = parseAbi([
  'function deployProxy(address implementation, uint256 salt, bytes data) returns (address proxy)',
  'function predictProxyAddress(address deployer, uint256 salt) view returns (address proxy)',
]);
export const RESOLVER_ABI = parseAbi([
  'function initialize((address account, uint256 roleBitmap)[] grants, bytes[] calls)',
  'function setText(bytes name, string key, string value)',
  'function grantSetterRoles(bytes setter, address account) returns (bool)',
  'function hasRoles(uint256 resource, uint256 roleBitmap, address account) view returns (bool)',
  'function multicall(bytes[] calls) returns (bytes[] results)',
]);
export const USER_REGISTRY_ABI = parseAbi([
  'function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)',
  'function getStatus(uint256 anyId) view returns (uint8)',
  'function getResolver(string label) view returns (address)',
  'function getExpiry(uint256 anyId) view returns (uint64)',
]);

/** DNS wire format (`\x05spike\x09re-charge\x03eth\x00`): the `name` every PermissionedResolver setter takes. */
export const dnsName = (name: string): Hex => toHex(packetToBytes(name));
/** The per-key EAC resource on a PermissionedResolver: keccak256(bytes(key)). */
export const textResource = (key: string): bigint => BigInt(keccak256(toBytes(key)));

export interface EnsCampaignsOptions {
  publicClient: Pick<
    PublicClient,
    | 'readContract'
    | 'getCode'
    | 'getTransactionCount'
    | 'estimateContractGas'
    | 'waitForTransactionReceipt'
  >;
  /** Carries the registrar account (the API's attestor key). */
  walletClient: Pick<WalletClient, 'writeContract' | 'account' | 'chain'>;
  /** "re-charge.eth". */
  parent: string;
  userRegistry: Address;
  factory?: Address;
  resolverImpl?: Address;
  now?: () => number;
  receiptTimeoutMs?: number;
}

interface Call {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
}

/** The node says this nonce is spent or occupied: our counter is behind, move past it. */
const nonceTaken = (error: unknown): boolean =>
  /nonce too low|nonce has already been used|replacement transaction underpriced/i.test(
    error instanceof Error ? error.message : String(error),
  );

/** A short, URL-free reason (viem's `details` can carry the RPC URL, which may hold an access key). */
const reason = (error: unknown): string => {
  const e = error as { shortMessage?: unknown; name?: unknown };
  if (typeof e.shortMessage === 'string') return e.shortMessage;
  return typeof e.name === 'string' ? e.name : 'error';
};

export class EnsCampaigns implements CampaignNames {
  readonly parent: string;
  readonly #o: Required<Omit<EnsCampaignsOptions, 'parent'>>;
  readonly #account: Address;
  #tail: Promise<unknown> = Promise.resolve();
  #nextNonce: number | undefined;

  constructor(opts: EnsCampaignsOptions) {
    const account = opts.walletClient.account;
    if (!account) throw new Error('EnsCampaigns needs a wallet client with the registrar account');
    this.parent = opts.parent;
    this.#account = account.address;
    this.#o = {
      publicClient: opts.publicClient,
      walletClient: opts.walletClient,
      userRegistry: getAddress(opts.userRegistry),
      factory: getAddress(opts.factory ?? ENS_SEPOLIA.verifiableFactory),
      resolverImpl: getAddress(opts.resolverImpl ?? ENS_SEPOLIA.permissionedResolverImpl),
      now: opts.now ?? Date.now,
      receiptTimeoutMs: opts.receiptTimeoutMs ?? RECEIPT_TIMEOUT_MS,
    };
  }

  /** The registrar address (the API's attestor). */
  get registrar(): Address {
    return this.#account;
  }

  async isAvailable(label: string): Promise<boolean> {
    return (await this.#status(label)) === AVAILABLE;
  }

  async ensureCampaignName(input: CampaignNameInput): Promise<CampaignNameResult> {
    if (!ENS_SLUG_PATTERN.test(input.slug))
      throw new AdapterError('names', 'invalid_name', 'ens: slug is not [a-z0-9-], 3–40');
    if (input.expiresAt <= this.#o.now())
      throw new AdapterError('names', 'invalid_expiry', 'ens: the campaign has ended');
    const sponsor = getAddress(input.sponsor);
    const name = `${input.slug}.${this.parent}`;
    const node = dnsName(name);
    const salt = BigInt(keccak256(input.campaignId));
    const resolver = getAddress(
      await this.#read<Address>(this.#o.factory, FACTORY_ABI, 'predictProxyAddress', [
        this.#account,
        salt,
      ]),
    );
    const txs: CampaignNameResult['txs'] = [];
    const sent = async (step: CampaignNameStep, call: Call) => {
      const hash = await this.#send(step, call);
      txs.push({ step, hash });
      await input.onTx?.(step, hash);
    };

    // 1. the campaign's own resolver, records written by its initializer (role checks are off while initializing)
    const code = await this.#guard('resolver', () =>
      this.#o.publicClient.getCode({ address: resolver }),
    );
    const deployed = code !== undefined && code !== '0x';
    if (!deployed) {
      const calls = Object.entries(input.records).map(([key, value]) =>
        encodeFunctionData({
          abi: RESOLVER_ABI,
          functionName: 'setText',
          args: [node, key, value],
        }),
      );
      const init = encodeFunctionData({
        abi: RESOLVER_ABI,
        functionName: 'initialize',
        args: [[{ account: this.#account, roleBitmap: API_RESOLVER_ROLES }], calls],
      });
      await sent('resolver', {
        address: this.#o.factory,
        abi: FACTORY_ABI,
        functionName: 'deployProxy',
        args: [this.#o.resolverImpl, salt, init],
      });
    }

    // 2. the name: owned by the sponsor with no roles, pointing at that resolver, expiring with the campaign
    const status = await this.#status(input.slug);
    if (status === REGISTERED) {
      const current = await this.#read<Address>(
        this.#o.userRegistry,
        USER_REGISTRY_ABI,
        'getResolver',
        [input.slug],
      );
      if (getAddress(current) !== resolver)
        throw new AdapterError('names', 'conflict', `ens: ${name} belongs to another campaign`);
    } else if (status === AVAILABLE) {
      await sent('register', {
        address: this.#o.userRegistry,
        abi: USER_REGISTRY_ABI,
        functionName: 'register',
        args: [
          input.slug,
          sponsor,
          zeroAddress,
          resolver,
          0n,
          BigInt(Math.floor(input.expiresAt / 1000)),
        ],
      });
    } else {
      throw new AdapterError('names', 'conflict', `ens: ${name} is reserved`);
    }

    // 3. the sponsor's keys: a resolver deployed just now has granted nothing yet (no read of a 1-block-old contract)
    const missing = deployed
      ? (
          await Promise.all(
            ENS_SPONSOR_TEXT_KEYS.map(async (key) =>
              (await this.#read<boolean>(resolver, RESOLVER_ABI, 'hasRoles', [
                textResource(key),
                ROLE_SET_TEXT,
                sponsor,
              ]))
                ? undefined
                : key,
            ),
          )
        ).filter((key) => key !== undefined)
      : [...ENS_SPONSOR_TEXT_KEYS];
    if (missing.length > 0) {
      const grants = missing.map((key) =>
        encodeFunctionData({
          abi: RESOLVER_ABI,
          functionName: 'grantSetterRoles',
          // decodeSetter reads only the selector and the key
          args: [
            encodeFunctionData({
              abi: RESOLVER_ABI,
              functionName: 'setText',
              args: ['0x00', key, ''],
            }),
            sponsor,
          ],
        }),
      );
      await sent('grant', {
        address: resolver,
        abi: RESOLVER_ABI,
        functionName: 'multicall',
        args: [grants],
      });
    }
    return { name, resolver, txs };
  }

  #status(label: string): Promise<number> {
    return this.#read<number>(this.#o.userRegistry, USER_REGISTRY_ABI, 'getStatus', [
      BigInt(labelhash(label)),
    ]).then(Number);
  }

  #read<T>(address: Address, abi: Abi, functionName: string, args: readonly unknown[]): Promise<T> {
    return this.#guard(
      functionName,
      () => this.#o.publicClient.readContract({ address, abi, functionName, args }) as Promise<T>,
    );
  }

  async #guard<T>(what: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      throw new AdapterError('names', 'unavailable', `ens: ${what} failed`, {
        reason: reason(error),
      });
    }
  }

  /** One transaction at a time: estimate (a revert sends nothing), sign with our nonce, wait for the receipt. */
  #send(step: CampaignNameStep, call: Call): Promise<Hex> {
    const task = () =>
      this.#guard(step, async () => {
        const { publicClient, walletClient } = this.#o;
        const account = walletClient.account!;
        const gas = await publicClient.estimateContractGas({ ...call, account });
        for (let attempt = 1; ; attempt += 1) {
          const pending = await publicClient.getTransactionCount({
            address: this.#account,
            blockTag: 'pending',
          });
          const nonce = Math.max(pending, this.#nextNonce ?? 0);
          let hash: Hex;
          try {
            hash = await walletClient.writeContract({
              ...call,
              account,
              chain: walletClient.chain ?? null,
              gas: (gas * 12n) / 10n,
              nonce,
            } as never);
          } catch (error) {
            if (attempt < 5 && nonceTaken(error)) {
              this.#nextNonce = nonce + 1;
              continue;
            }
            throw error;
          }
          this.#nextNonce = nonce + 1;
          const receipt = await publicClient.waitForTransactionReceipt({
            hash,
            timeout: this.#o.receiptTimeoutMs,
          });
          if (receipt.status !== 'success')
            throw new AdapterError('names', 'unavailable', `ens: ${step} reverted`, { tx: hash });
          return hash;
        }
      });
    const next = this.#tail.then(task, task);
    this.#tail = next.catch(() => undefined);
    return next;
  }
}

export interface EnsCampaignsConfig {
  rpcUrl: string;
  /** The registrar key (the API's attestor); never logged. */
  privateKey: Hex;
  parent: string;
  userRegistry: Address;
  factory?: Address;
  resolverImpl?: Address;
  fetch?: typeof fetch;
  now?: () => number;
}

/** Sepolia clients over `rpcUrl`; viem refuses to sign when the node is not chain 11155111. */
export function createEnsCampaigns(config: EnsCampaignsConfig): EnsCampaigns {
  const chain = { ...sepolia, rpcUrls: { default: { http: [config.rpcUrl] } } };
  const transport = http(config.rpcUrl, {
    retryCount: 1,
    timeout: 20_000,
    ...(config.fetch ? { fetchFn: config.fetch } : {}),
  });
  return new EnsCampaigns({
    publicClient: createPublicClient({ chain, transport, pollingInterval: 2_000 }),
    walletClient: createWalletClient({
      chain,
      transport,
      account: privateKeyToAccount(config.privateKey),
    }),
    parent: config.parent,
    userRegistry: config.userRegistry,
    ...(config.factory ? { factory: config.factory } : {}),
    ...(config.resolverImpl ? { resolverImpl: config.resolverImpl } : {}),
    ...(config.now ? { now: config.now } : {}),
  });
}
