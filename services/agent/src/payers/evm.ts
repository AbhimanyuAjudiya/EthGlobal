/**
 * EvmPayer — the exact-EVM (EIP-3009) wallet: Anvil #4 against MockUSDC3009 locally (`AnvilEvmSigner`), a Base Sepolia
 * key live. Typed data, domain and wire form come from `@ethglobal/eip3009` only (no second typed-data builder). The
 * domain the 402 advertises in `extra` must equal the token's own `readDomain()` (read once at boot) and, where the
 * protocol table knows the network, `USDC_EIP712_DOMAIN` (A-21); otherwise nothing is signed (T-56).
 */
import { getAddress, type Address, type Hex, type LocalAccount, type PublicClient } from 'viem';

import { bytesToHex, randomBytes } from '@ethglobal/crypto';
import {
  domainFromRequirements,
  readDomain,
  TOKEN_READ_ABI,
  toPaymentAuthorization,
  typedDataTransferWithAuthorization,
  type Authorization3009,
} from '@ethglobal/eip3009';
import { PAYMENT_VALIDITY_S, USDC_EIP712_DOMAIN } from '@ethglobal/protocol/ids';
import type {
  PaymentPayload,
  PaymentRequirements,
  PaymentResource,
} from '@ethglobal/protocol/schemas';

import { chooseFirstAcceptable, PayerRefusal, type Payer } from './types.js';

export interface EvmPayerOptions {
  account: LocalAccount;
  publicClient: PublicClient;
  /** CAIP-2, e.g. eip155:31337. */
  network: string;
  /** The allow-listed token (MockUSDC3009 / Base Sepolia USDC). */
  asset: Address;
  random32?: () => Hex;
}

/** Seconds of tolerance below `now` for validAfter (EIP-3009 is strict: validAfter < block.timestamp). */
const VALID_AFTER_SKEW_S = 60;

export class EvmPayer implements Payer {
  readonly network: string;
  readonly address: Address;
  readonly #opts: EvmPayerOptions;
  #domain: { name: string; version: string; chainId: number } | undefined;

  constructor(opts: EvmPayerOptions) {
    this.#opts = opts;
    this.network = opts.network;
    this.address = opts.account.address;
  }

  /** Reads the token's EIP-712 domain once (ERC-5267, fallback name()/version()); call before the first tick. */
  async init(): Promise<this> {
    const d = await readDomain(this.#opts.publicClient, this.#opts.asset);
    if (`eip155:${d.chainId}` !== this.network) {
      throw new Error(`EVM RPC is chain ${d.chainId}, payer is configured for ${this.network}`);
    }
    this.#domain = d;
    return this;
  }

  get domain(): { name: string; version: string; chainId: number } | undefined {
    return this.#domain;
  }

  refusal(req: PaymentRequirements): string | undefined {
    if (req.network !== this.network) return 'network';
    if (req.asset.toLowerCase() !== this.#opts.asset.toLowerCase()) return 'asset';
    if (this.#domain === undefined) return 'domain-unknown';
    const name = req.extra?.name;
    const version = req.extra?.version;
    if (name !== this.#domain.name || version !== this.#domain.version) return 'domain-mismatch';
    const pinned = USDC_EIP712_DOMAIN[this.network];
    if (pinned && (pinned.name !== name || pinned.version !== version)) return 'domain-mismatch';
    return undefined;
  }

  choose(accepts: PaymentRequirements[]): PaymentRequirements | undefined {
    return chooseFirstAcceptable(this, accepts);
  }

  async balanceUsd6(): Promise<bigint> {
    return this.#opts.publicClient.readContract({
      address: this.#opts.asset,
      abi: TOKEN_READ_ABI,
      functionName: 'balanceOf',
      args: [this.address],
    });
  }

  async sign(
    req: PaymentRequirements,
    ctx: { resource: PaymentResource; nonce?: Hex; now: number },
  ): Promise<PaymentPayload> {
    const refused = this.refusal(req);
    if (refused !== undefined)
      throw new PayerRefusal('domain-mismatch', `EVM payer refuses: ${refused}`);
    const value = BigInt(req.amount);
    const balance = await this.balanceUsd6();
    if (balance < value) {
      throw new PayerRefusal('insufficient-balance', `balance ${balance} < value ${value}`);
    }
    const nowS = BigInt(Math.floor(ctx.now / 1000));
    const authorization: Authorization3009 = {
      from: this.address,
      to: getAddress(req.payTo),
      value,
      validAfter: nowS - BigInt(VALID_AFTER_SKEW_S),
      validBefore: nowS + BigInt(Math.min(req.maxTimeoutSeconds, PAYMENT_VALIDITY_S)),
      // top-ups deliver no LPA, so no session binding: a fresh random nonce per signature
      nonce: ctx.nonce ?? this.#opts.random32?.() ?? bytesToHex(randomBytes(32)),
    };
    const signature = await this.#opts.account.signTypedData(
      typedDataTransferWithAuthorization(domainFromRequirements(req), authorization),
    );
    return {
      x402Version: 2,
      resource: ctx.resource,
      accepted: req,
      payload: { signature, authorization: toPaymentAuthorization(authorization) },
    };
  }
}

/** The local name for the same class (DECISION §6.2: "local: an Anvil key against MockUSDC3009"). */
export const AnvilEvmSigner = EvmPayer;
