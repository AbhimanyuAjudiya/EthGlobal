/**
 * SelfRunFacilitator (INTERFACES §3.3; T-13, T-15, T-16, T-17, T-75): x402 exact-EVM verify + settle with
 * @ethglobal/eip3009 and a Relayer. Verify performs every check the token will make, off-chain, before a single
 * gas unit is spent; settle recovers a front-run (the authorization already executed by someone else).
 */
import {
  digestReceiveWithAuthorization,
  digestTransferWithAuthorization,
  domainFromRequirements,
  EIP3009_ABI,
  Eip3009Error,
  encodeReceiveWithAuthorization,
  encodeTransferWithAuthorization,
  fromPaymentAuthorization,
  readDomain,
  recoverSigner,
  TOKEN_READ_ABI,
  type Authorization3009,
  type Relayer,
} from '@ethglobal/eip3009';
import { isEvmExact, type EvmExactPayload } from '@ethglobal/protocol/schemas';
import { getAddress, isAddressEqual, type Address, type Hex, type PublicClient, type TypedDataDomain } from 'viem';

import { buildPaymentRequired, sameRequirements } from '../payment-requirements.js';
import { toAdapterError } from './errors.js';
import { KeyedWindow } from './rate-limit.js';

import type {
  PaymentPayload,
  PaymentRail,
  PaymentRequired,
  PaymentRequirementInput,
  PaymentRequirements,
  SettleResult,
  VerifyResult,
} from '../types.js';

/** How far back settle looks for the Transfer of a front-run authorization (T-15). */
export const FRONT_RUN_LOOKBACK_BLOCKS = 20n;

export interface SelfRunFacilitatorOptions {
  publicClient: PublicClient;
  relayer: Relayer;
  token: Address;
  chainId: number;
  network: string;
  now: () => number;
  /** Settlements per payer per minute (default 5, T-16). */
  perFromRateLimit?: number;
}

type Checked =
  | { ok: false; reason: string; payer?: string; auth?: Authorization3009 }
  | { ok: true; auth: Authorization3009; signature: Hex; kind: 'transfer' | 'receive' };

export class SelfRunFacilitator implements PaymentRail {
  readonly #opts: SelfRunFacilitatorOptions;
  readonly #token: Address;
  readonly #window: KeyedWindow;
  #domain: Promise<{ name: string; version: string; chainId: number }> | undefined;

  constructor(opts: SelfRunFacilitatorOptions) {
    if (opts.network !== `eip155:${opts.chainId}`) throw new Error(`network ${opts.network} ≠ eip155:${opts.chainId}`);
    this.#opts = opts;
    this.#token = getAddress(opts.token);
    this.#window = new KeyedWindow(opts.perFromRateLimit ?? 5, 60_000);
  }

  createPaymentRequirement(input: PaymentRequirementInput): PaymentRequired {
    return buildPaymentRequired(input);
  }

  async verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResult> {
    const checked = await this.#check(payload, requirements);
    return checked.ok
      ? { isValid: true, payer: checked.auth.from }
      : { isValid: false, invalidReason: checked.reason, ...(checked.payer ? { payer: checked.payer } : {}) };
  }

  async settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResult> {
    const { network } = requirements;
    const fail = (errorReason: string, payer?: string): SettleResult => ({
      success: false,
      errorReason,
      network,
      transaction: '',
      ...(payer ? { payer } : {}),
    });
    const checked = await this.#check(payload, requirements);
    if (!checked.ok && checked.reason === 'nonce_already_used' && checked.auth) {
      // Already executed — by us earlier, or by anyone who saw the authorization (T-15): the payment happened.
      const tx = await this.#frontRunTx(checked.auth);
      if (tx) return { success: true, transaction: tx, network, payer: checked.auth.from };
    }
    if (!checked.ok) return fail(checked.reason, checked.payer);
    const { auth, signature, kind } = checked;
    if (!this.#window.hit(auth.from.toLowerCase(), this.#opts.now())) return fail('rate_limited', auth.from);
    const data =
      kind === 'receive' ? encodeReceiveWithAuthorization(auth, signature) : encodeTransferWithAuthorization(auth, signature);
    let outcome: { hash: Hex; status: 'success' | 'reverted' } | undefined;
    try {
      outcome = await this.#opts.relayer.submit(this.#token, data);
    } catch (error) {
      if (!(error instanceof Eip3009Error && error.code === 'simulation_reverted')) throw toAdapterError('payments', error);
    }
    if (outcome?.status === 'success') {
      return { success: true, transaction: outcome.hash, network, payer: auth.from };
    }
    // Reverted (or the simulation reverted): if the nonce is now used, someone else submitted OUR authorization —
    // the funds still went to payTo, so the user has paid (T-15, A15).
    const frontRun = await this.#frontRunTx(auth);
    if (frontRun) return { success: true, transaction: frontRun, network, payer: auth.from };
    return fail(outcome ? 'settle_reverted' : 'simulation_reverted', auth.from);
  }

  async #check(payload: PaymentPayload, requirements: PaymentRequirements): Promise<Checked> {
    const no = (reason: string, payer?: string): Checked => ({ ok: false, reason, ...(payer ? { payer } : {}) });
    if (payload.x402Version !== 2) return no('unsupported_x402_version');
    if (!isEvmExact(payload.payload)) return no('unsupported_scheme');
    if (requirements.network !== this.#opts.network || payload.accepted.network !== this.#opts.network) {
      return no('unsupported_scheme');
    }
    if (!isAddressEqual(requirements.asset as Address, this.#token) || !sameRequirements(payload.accepted, requirements)) {
      return no('requirements_mismatch');
    }
    let auth: Authorization3009;
    try {
      auth = fromPaymentAuthorization((payload.payload as EvmExactPayload).authorization);
    } catch {
      return no('invalid_payload');
    }
    const payer = auth.from;
    try {
      const domain = await this.#domainFor(requirements);
      if (!domain) return no('requirements_mismatch', payer);
      const kind = await this.#signedKind(domain, auth, payload.payload.signature as Hex, requirements.payTo);
      if (!kind) return no('invalid_signature', payer);
      if (!isAddressEqual(auth.to, requirements.payTo as Address)) return no('recipient_mismatch', payer);
      const amount = BigInt(requirements.amount);
      if (auth.value < amount) return no('insufficient_amount', payer);
      if (auth.value > amount) return no('amount_mismatch', payer);
      const now = BigInt(Math.floor(this.#opts.now() / 1000));
      // EIP-3009 is strict at both ends (D-24): validAfter < now < validBefore.
      if (auth.validAfter >= now) return no('not_yet_valid', payer);
      if (auth.validBefore <= now) return no('expired', payer);
      const client = this.#opts.publicClient;
      const [used, balance] = await Promise.all([
        client.readContract({ address: this.#token, abi: EIP3009_ABI, functionName: 'authorizationState', args: [auth.from, auth.nonce] }),
        client.readContract({ address: this.#token, abi: TOKEN_READ_ABI, functionName: 'balanceOf', args: [auth.from] }),
      ]);
      if (used) return { ok: false, reason: 'nonce_already_used', payer, auth };
      if (balance < auth.value) return no('insufficient_funds', payer);
      return { ok: true, auth, signature: payload.payload.signature as Hex, kind };
    } catch (error) {
      throw toAdapterError('payments', error);
    }
  }

  /** The domain the payer was told to sign (extra.{name,version}); it must equal the token's own (A-21). */
  async #domainFor(requirements: PaymentRequirements): Promise<TypedDataDomain | undefined> {
    let advertised: TypedDataDomain;
    try {
      advertised = domainFromRequirements(requirements);
    } catch {
      return undefined;
    }
    this.#domain ??= readDomain(this.#opts.publicClient, this.#token).catch((error: unknown) => {
      this.#domain = undefined;
      throw error;
    });
    const onChain = await this.#domain;
    const same =
      onChain.name === advertised.name &&
      onChain.version === advertised.version &&
      onChain.chainId === this.#opts.chainId &&
      advertised.chainId === this.#opts.chainId;
    return same ? advertised : undefined;
  }

  /**
   * Which typed data the signature is over: TransferWithAuthorization (what x402 clients sign), or — only when
   * payTo is the relayer itself, so nobody else can submit it — ReceiveWithAuthorization.
   */
  async #signedKind(domain: TypedDataDomain, auth: Authorization3009, signature: Hex, payTo: string) {
    const recovers = async (digest: Hex) => (await recoverSigner(digest, signature).catch(() => undefined)) === auth.from;
    if (await recovers(digestTransferWithAuthorization(domain, auth))) return 'transfer' as const;
    const relayer = this.#opts.relayer.address;
    if (relayer && isAddressEqual(relayer, payTo as Address) && (await recovers(digestReceiveWithAuthorization(domain, auth)))) {
      return 'receive' as const;
    }
    return undefined;
  }

  async #frontRunTx(auth: Authorization3009): Promise<Hex | undefined> {
    try {
      const client = this.#opts.publicClient;
      const consumed = await client.readContract({
        address: this.#token,
        abi: EIP3009_ABI,
        functionName: 'authorizationState',
        args: [auth.from, auth.nonce],
      });
      if (!consumed) return undefined;
      const head = await client.getBlockNumber();
      const range = { fromBlock: head > FRONT_RUN_LOOKBACK_BLOCKS ? head - FRONT_RUN_LOOKBACK_BLOCKS : 0n, toBlock: head };
      // The exact tx that consumed THIS nonce (a cancelAuthorization emits AuthorizationCanceled, never this) …
      const used = await client.getContractEvents({
        address: this.#token,
        abi: EIP3009_ABI,
        eventName: 'AuthorizationUsed',
        args: { authorizer: auth.from, nonce: auth.nonce },
        ...range,
      });
      const txs = new Set(used.map((log) => log.transactionHash));
      // … and in that same tx, the Transfer(from, payTo, value) the payer authorised.
      const transfers = await client.getContractEvents({
        address: this.#token,
        abi: EIP3009_ABI,
        eventName: 'Transfer',
        args: { from: auth.from, to: auth.to },
        ...range,
      });
      return transfers.find((log) => log.args.value === auth.value && txs.has(log.transactionHash))?.transactionHash ?? undefined;
    } catch (error) {
      throw toAdapterError('payments', error);
    }
  }
}
