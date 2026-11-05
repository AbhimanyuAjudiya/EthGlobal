/**
 * FakeUsdc3009: an in-memory FiatTokenV2_2 / MockUSDC3009 for unit tests of the self-run facilitator and the
 * treasury. It verifies authorizations exactly as the contract does (strict window, unused nonce, ecrecover ==
 * from, balance) using @ethglobal/eip3009, and exposes the viem PublicClient subset and a Relayer over it.
 */
import { decodeFunctionData, getAddress, type Address, type Hex, type PublicClient } from 'viem';

import { sha256Hex } from '@ethglobal/crypto';
import {
  digestReceiveWithAuthorization,
  digestTransferWithAuthorization,
  domain as eip712Domain,
  EIP3009_ABI,
  Eip3009Error,
  recoverSigner,
  type Relayer,
} from '@ethglobal/eip3009';

export interface FakeTransfer {
  from: Address;
  to: Address;
  value: bigint;
  transactionHash: Hex;
  blockNumber: bigint;
}

export interface FakeUsdcOptions {
  address: Address;
  chainId: number;
  name: string;
  version: string;
  /** ms clock; block.timestamp = floor(now / 1000). */
  now: () => number;
  balances?: Record<string, bigint>;
  /** false: the token has no ERC-5267 eip712Domain() (readDomain falls back to name()/version()). */
  erc5267?: boolean;
}

export class FakeUsdc3009 {
  readonly address: Address;
  readonly transfers: FakeTransfer[] = [];
  /** AuthorizationUsed(authorizer, nonce) logs. */
  readonly authorizationsUsed: {
    authorizer: Address;
    nonce: Hex;
    transactionHash: Hex;
    blockNumber: bigint;
  }[] = [];
  /** Every calldata a relayer actually sent (simulations excluded). */
  readonly sent: Hex[] = [];
  readonly #opts: FakeUsdcOptions;
  readonly #balances = new Map<string, bigint>();
  readonly #used = new Set<string>();
  readonly #receipts = new Map<Hex, 'success' | 'reverted'>();
  blockNumber = 100n;
  /** When set, every read throws (an RPC outage). */
  failReads = false;

  constructor(opts: FakeUsdcOptions) {
    this.#opts = opts;
    this.address = getAddress(opts.address);
    for (const [k, v] of Object.entries(opts.balances ?? {}))
      this.#balances.set(k.toLowerCase(), v);
  }

  balanceOf(account: string): bigint {
    return this.#balances.get(account.toLowerCase()) ?? 0n;
  }

  mint(account: string, value: bigint): void {
    this.#balances.set(account.toLowerCase(), this.balanceOf(account) + value);
  }

  /** Why the call would revert, or undefined when it would succeed (the contract's own checks). */
  async revertReason(data: Hex, sender: Address): Promise<string | undefined> {
    const { functionName, args } = decodeFunctionData({ abi: EIP3009_ABI, data });
    if (
      functionName !== 'transferWithAuthorization' &&
      functionName !== 'receiveWithAuthorization'
    ) {
      return 'unsupported call';
    }
    const [from, to, value, validAfter, validBefore, nonce, signature] = args;
    const auth = { from, to, value, validAfter, validBefore, nonce };
    const now = BigInt(Math.floor(this.#opts.now() / 1000));
    if (!(now > validAfter)) return 'authorization is not yet valid';
    if (!(now < validBefore)) return 'authorization is expired';
    if (this.#used.has(`${from.toLowerCase()}:${nonce.toLowerCase()}`))
      return 'authorization is used or canceled';
    const d = eip712Domain(this.address, this.#opts.chainId, this.#opts.name, this.#opts.version);
    const receive = functionName === 'receiveWithAuthorization';
    if (receive && getAddress(to) !== getAddress(sender)) return 'caller must be the payee';
    const digest = receive
      ? digestReceiveWithAuthorization(d, auth)
      : digestTransferWithAuthorization(d, auth);
    const signer = await recoverSigner(digest, signature).catch(() => undefined);
    if (signer !== getAddress(from)) return 'invalid signature';
    if (this.balanceOf(from) < value) return 'transfer amount exceeds balance';
    return undefined;
  }

  /** Mines `data` from `sender`: applies it or records a revert, like a real transaction. */
  async execute(
    data: Hex,
    sender: Address,
  ): Promise<{ hash: Hex; status: 'success' | 'reverted' }> {
    this.blockNumber += 1n;
    const hash = sha256Hex(`tx:${this.blockNumber}:${data}:${sender}`);
    const reason = await this.revertReason(data, sender);
    if (reason) {
      this.#receipts.set(hash, 'reverted');
      return { hash, status: 'reverted' };
    }
    const { args } = decodeFunctionData({ abi: EIP3009_ABI, data });
    const [from, to, value, , , nonce] = args as unknown as [
      Address,
      Address,
      bigint,
      bigint,
      bigint,
      Hex,
    ];
    this.#used.add(`${from.toLowerCase()}:${nonce.toLowerCase()}`);
    this.authorizationsUsed.push({
      authorizer: getAddress(from),
      nonce,
      transactionHash: hash,
      blockNumber: this.blockNumber,
    });
    this.#balances.set(from.toLowerCase(), this.balanceOf(from) - value);
    this.mint(to, value);
    this.transfers.push({
      from: getAddress(from),
      to: getAddress(to),
      value,
      transactionHash: hash,
      blockNumber: this.blockNumber,
    });
    this.#receipts.set(hash, 'success');
    return { hash, status: 'success' };
  }

  /** A Relayer that simulates (eth_call) first, like createViemRelayer({ simulate }). */
  relayer(address: Address, simulate = true): Relayer {
    return {
      address: getAddress(address),
      submit: async (token, data) => {
        if (getAddress(token) !== this.address) throw new Error('wrong token');
        if (simulate) {
          const reason = await this.revertReason(data, address);
          if (reason) throw new Eip3009Error('simulation_reverted', `eth_call reverted: ${reason}`);
        }
        this.sent.push(data);
        return this.execute(data, address);
      },
    };
  }

  #read<T>(value: () => T): Promise<T> {
    return this.failReads
      ? Promise.reject(new Error('HTTP request failed'))
      : Promise.resolve(value());
  }

  /** The viem PublicClient subset the facilitator and treasury use. */
  publicClient(): PublicClient {
    const client = {
      getChainId: () => this.#read(() => this.#opts.chainId),
      getBlockNumber: () => this.#read(() => this.blockNumber),
      readContract: ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) =>
        this.#read(() => {
          switch (functionName) {
            case 'eip712Domain':
              if (this.#opts.erc5267 === false) throw new Error('execution reverted');
              return [
                '0x0f',
                this.#opts.name,
                this.#opts.version,
                BigInt(this.#opts.chainId),
                this.address,
                `0x${'0'.repeat(64)}`,
                [],
              ];
            case 'name':
              return this.#opts.name;
            case 'version':
              return this.#opts.version;
            case 'balanceOf':
              return this.balanceOf(args![0] as string);
            case 'authorizationState':
              return this.#used.has(
                `${(args![0] as string).toLowerCase()}:${(args![1] as string).toLowerCase()}`,
              );
            default:
              throw new Error(`unsupported read ${functionName}`);
          }
        }),
      getContractEvents: ({
        eventName,
        args,
        fromBlock,
        toBlock,
      }: {
        eventName: string;
        args: { from?: Address; to?: Address; authorizer?: Address; nonce?: Hex };
        fromBlock: bigint;
        toBlock: bigint;
      }) =>
        this.#read(() =>
          eventName === 'AuthorizationUsed'
            ? this.authorizationsUsed
                .filter(
                  (u) =>
                    u.authorizer === getAddress(args.authorizer!) &&
                    u.nonce.toLowerCase() === args.nonce!.toLowerCase(),
                )
                .filter((u) => u.blockNumber >= fromBlock && u.blockNumber <= toBlock)
                .map((u) => ({
                  args: { authorizer: u.authorizer, nonce: u.nonce },
                  transactionHash: u.transactionHash,
                  blockNumber: u.blockNumber,
                }))
            : this.transfers
                .filter(
                  (t) =>
                    (!args.from || t.from === getAddress(args.from)) &&
                    (!args.to || t.to === getAddress(args.to)),
                )
                .filter((t) => t.blockNumber >= fromBlock && t.blockNumber <= toBlock)
                .map((t) => ({
                  args: { from: t.from, to: t.to, value: t.value },
                  transactionHash: t.transactionHash,
                  blockNumber: t.blockNumber,
                })),
        ),
      waitForTransactionReceipt: ({ hash }: { hash: Hex }) =>
        this.#read(() => ({
          status: this.#receipts.get(hash) ?? 'reverted',
          transactionHash: hash,
        })),
      getTransactionReceipt: ({ hash }: { hash: Hex }) =>
        this.#read(() => ({
          status: this.#receipts.get(hash) ?? 'reverted',
          transactionHash: hash,
        })),
    };
    return client as unknown as PublicClient;
  }
}
