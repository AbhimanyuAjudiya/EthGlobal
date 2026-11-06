/**
 * Human Hedera payments over WalletConnect v2, HIP-820 (HashPack): native transaction and message signing.
 * The PWA builds the HTS TransferTransaction body itself with @hiero-ledger/proto (no SDK in
 * the browser), the wallet returns only a SignatureMap, and the payload is assembled from OUR body bytes — whatever
 * the wallet answers, it can only add a signature to the transfer built here.
 *
 * The body mirrors `@x402/hedera` 2.29.0 `createClientHederaSigner` (what services/agent pays with) for one node:
 * transactionID.accountID = the facilitator's `extra.feePayer`, `-amount` from the user / `+amount` to `payTo`,
 * fee 1 ħ max, 120 s valid. Top-ups have an empty memo; purchases bind their activation session in the signed memo.
 * test/hedera-wc.test.ts checks the top-up bytes against that signer.
 * `hashPackSigner(...)` has the `ClientHederaSigner` shape, so `ExactHederaScheme` (@x402/hedera/exact/client) takes it.
 */
import { proto } from '@hiero-ledger/proto';
import SignClient from '@walletconnect/sign-client';

import { HEDERA_MAX_TIMEOUT_S, type Hex } from '@ethglobal/protocol/ids';
import type {
  PaymentPayload,
  PaymentRequirements,
  PaymentResource,
} from '@ethglobal/protocol/schemas';
import {
  hederaSessionMemo,
  parseHederaSessionMemo,
  type PaymentSigner,
} from '@ethglobal/protocol/x402';

import type { AcceptTerm, SignerHooks } from './pay402';
import type { SessionTypes } from '@walletconnect/types';

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';

export const HEDERA_ID = /^0\.0\.\d{1,12}$/;
const CHAINS = ['hedera:testnet', 'hedera:mainnet'] as const;
export type HederaChain = (typeof CHAINS)[number];
const SIGN = 'hedera_signTransaction';
const SIGN_MESSAGE = 'hedera_signMessage';
// ponytail: one fixed node (0.0.3 exists on testnet and mainnet); the facilitator can only submit to it. Pick from
// `hedera_getNodeAddresses` if 0.0.3 is ever unhealthy.
const NODE = '0.0.3';
const MAX_FEE_TINYBARS = 100_000_000; // 1 ħ, the SDK client default; the facilitator pays it
const VALID_DURATION_S = 120;

const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

export const isHederaChain = (n: string): n is HederaChain =>
  (CHAINS as readonly string[]).includes(n);

/**
 * int64 as a JS number, as the generated encoder expects (it skips a numeric 0, the proto3 default, like the SDK's
 * Long 0); the generated types only name Long. Beyond 2^53 refuse rather than round.
 */
type Long = NonNullable<proto.ITimestamp['seconds']>;
const int64 = (v: string | number | bigint): Long => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error('integer out of range');
  return n as unknown as Long;
};

/** "0.0.n" → its three int64 parts (callers have checked HEDERA_ID). */
const parts = (id: string): [Long, Long, Long] => {
  const [s, r, n] = id.split('.');
  return [int64(s!), int64(r!), int64(n!)];
};
const accountProto = (id: string) => {
  const [shardNum, realmNum, accountNum] = parts(id);
  return { shardNum, realmNum, accountNum };
};

/** The fee payer the facilitator advertised, or undefined (fail closed). */
const feePayerOf = (req: PaymentRequirements): string | undefined => {
  const v = req.extra?.feePayer;
  return typeof v === 'string' && HEDERA_ID.test(v) ? v : undefined;
};

/**
 * TransactionBody bytes of the one transfer this PWA ever signs. Everything comes from the server's accepts entry
 * except the user's own account; anything malformed throws before a wallet is asked.
 */
export function transferBodyBytes(
  req: PaymentRequirements,
  accountId: string,
  now: number = Date.now(),
  random: () => number = Math.random,
  nonce?: Hex,
): Uint8Array {
  const feePayer = feePayerOf(req);
  if (req.scheme !== 'exact' || !isHederaChain(req.network))
    throw new Error('not a Hedera exact offer');
  if (!feePayer) throw new Error('extra.feePayer is missing');
  if (
    req.extra?.sessionKeyRequired === true &&
    (!nonce || req.extra.sessionBinding !== 'hedera-memo-v1')
  )
    throw new Error('this purchase requires a supported session binding');
  if (!HEDERA_ID.test(accountId) || !HEDERA_ID.test(req.payTo) || !HEDERA_ID.test(req.asset))
    throw new Error('malformed Hedera id');
  if (accountId === req.payTo || accountId === feePayer)
    throw new Error('payer is payTo or fee payer');
  if (!/^[1-9]\d{0,17}$/.test(req.amount)) throw new Error('amount must be a positive integer');
  const amount = BigInt(req.amount);
  // the SDK's Timestamp.generate(): back-dated 3-8 s against clock skew, random nanos
  const start = now - (Math.floor(random() * 5000) + 3000);
  const nanos = (start % 1000) * 1_000_000 + Math.floor(random() * 1_000_000);
  const legs = [
    { id: accountId, amount: -amount },
    { id: req.payTo, amount },
  ].sort((a, b) => Number(BigInt(a.id.split('.')[2]!) - BigInt(b.id.split('.')[2]!)));
  const [shardNum, realmNum, tokenNum] = parts(req.asset);
  return proto.TransactionBody.encode({
    cryptoTransfer: {
      transfers: { accountAmounts: [] },
      tokenTransfers: [
        {
          token: { shardNum, realmNum, tokenNum },
          transfers: legs.map((l) => ({
            accountID: accountProto(l.id),
            amount: int64(l.amount),
            isApproval: false,
          })),
          nftTransfers: [],
        },
      ],
    },
    transactionFee: int64(MAX_FEE_TINYBARS),
    memo: nonce ? hederaSessionMemo(nonce) : '',
    transactionID: {
      accountID: accountProto(feePayer),
      transactionValidStart: { seconds: int64(Math.floor(start / 1000)), nanos },
      scheduled: false,
    },
    nodeAccountID: accountProto(NODE),
    transactionValidDuration: { seconds: int64(VALID_DURATION_S) },
  }).finish();
}

/** The SDK's `Transaction.toBytes()` layout: a TransactionList of one `{ signedTransactionBytes }` for our node. */
export function assembleTransaction(bodyBytes: Uint8Array, signatureMap: Uint8Array): Uint8Array {
  const sigMap = proto.SignatureMap.decode(signatureMap);
  if (!sigMap.sigPair?.length) throw new Error('the wallet returned no signature');
  const signedTransactionBytes = proto.SignedTransaction.encode({ bodyBytes, sigMap }).finish();
  return proto.TransactionList.encode({ transactionList: [{ signedTransactionBytes }] }).finish();
}

/** What a live HashPack session gives the pay flow. */
export interface HashPackSession {
  topic: string;
  chain: HederaChain;
  accountId: string;
}

type Request = (p: {
  topic: string;
  chainId: string;
  request: { method: string; params: unknown };
}) => Promise<unknown>;

/** The `@x402/hedera` ClientHederaSigner shape over a WalletConnect session: sign only the transfer built here. */
export function hashPackSigner(
  session: HashPackSession,
  request: Request,
  alive: () => boolean = () => true,
  now: () => number = Date.now,
) {
  return {
    accountId: session.accountId,
    async createPartiallySignedTransferTransaction(
      req: PaymentRequirements,
      nonce?: Hex,
    ): Promise<string> {
      if (req.network !== session.chain)
        throw new Error('the HashPack session is on another network');
      if (!alive()) throw new Error('the HashPack session ended');
      const body = transferBodyBytes(req, session.accountId, now(), Math.random, nonce);
      const res = await request({
        topic: session.topic,
        chainId: session.chain,
        request: {
          method: SIGN,
          params: {
            signerAccountId: `${session.chain}:${session.accountId}`,
            transactionBody: b64(body),
          },
        },
      });
      const sig = (res as { signatureMap?: unknown } | null)?.signatureMap;
      if (typeof sig !== 'string') throw new Error('the wallet returned no signatureMap');
      return b64(assembleTransaction(body, unb64(sig)));
    },
  };
}

/** The x402 PaymentSigner for a HashPack session: the allow-listed Hedera offer only, payload `{ transaction }`. */
export class HashPackPaySigner implements PaymentSigner {
  readonly label = 'HashPack';
  constructor(
    private readonly signer: ReturnType<typeof hashPackSigner>,
    private readonly network: HederaChain,
    private readonly allow: readonly AcceptTerm[],
    private readonly hooks: SignerHooks = {},
  ) {}

  choose(accepts: PaymentRequirements[]): PaymentRequirements | undefined {
    return accepts.find(
      (a) =>
        a.scheme === 'exact' &&
        a.network === this.network &&
        feePayerOf(a) !== undefined &&
        a.maxTimeoutSeconds <= HEDERA_MAX_TIMEOUT_S &&
        (a.extra?.sessionKeyRequired !== true || a.extra.sessionBinding === 'hedera-memo-v1') &&
        this.allow.some(
          (t) => t.network === a.network && t.asset === a.asset && t.payTo === a.payTo,
        ),
    );
  }

  async sign(
    req: PaymentRequirements,
    ctx: { resource: PaymentResource; nonce?: Hex },
  ): Promise<PaymentPayload> {
    this.hooks.onSigning?.();
    const transaction = await this.signer.createPartiallySignedTransferTransaction(req, ctx.nonce);
    return { x402Version: 2, resource: ctx.resource, accepted: req, payload: { transaction } };
  }

  /** Check the memo in the actual signed body; unsigned payload metadata never proves a binding. */
  sessionBinding(payment: PaymentPayload): Hex | undefined {
    try {
      if (payment.accepted.network !== this.network || !('transaction' in payment.payload))
        return undefined;
      const raw = unb64(payment.payload.transaction);
      const list = proto.TransactionList.decode(raw);
      const canonical = proto.TransactionList.encode(list).finish();
      if (!sameBytes(canonical, raw)) return undefined;
      if (list.transactionList.length !== 1) return undefined;
      const transaction = list.transactionList[0]!;
      if (
        !transaction.signedTransactionBytes?.length ||
        transaction.bodyBytes?.length ||
        transaction.body ||
        transaction.sigMap ||
        transaction.sigs
      )
        return undefined;
      const signed = proto.SignedTransaction.decode(transaction.signedTransactionBytes);
      if (
        !sameBytes(
          proto.SignedTransaction.encode(signed).finish(),
          transaction.signedTransactionBytes,
        )
      )
        return undefined;
      if (!signed.bodyBytes?.length || !signed.sigMap?.sigPair?.length) return undefined;
      const body = proto.TransactionBody.decode(signed.bodyBytes);
      if (!sameBytes(proto.TransactionBody.encode(body).finish(), signed.bodyBytes))
        return undefined;
      if (!body.cryptoTransfer) return undefined;
      const allowed = new Set([
        'cryptoTransfer',
        'transactionFee',
        'memo',
        'transactionID',
        'nodeAccountID',
        'transactionValidDuration',
      ]);
      if (
        body.maxCustomFees.length ||
        Object.keys(body).some((key) => key !== 'maxCustomFees' && !allowed.has(key))
      )
        return undefined;
      return parseHederaSessionMemo(body.memo);
    } catch {
      return undefined;
    }
  }
}

/** HIP-820 returns a SignatureMap for the supplied plain message; the wallet adds the Hedera prefix. */
export function hashPackMessageSigner(
  session: HashPackSession,
  request: Request,
  alive: () => boolean = () => true,
) {
  return async (message: string): Promise<string> => {
    if (!alive()) throw new Error('the HashPack session ended');
    const result = await request({
      topic: session.topic,
      chainId: session.chain,
      request: {
        method: SIGN_MESSAGE,
        params: { signerAccountId: `${session.chain}:${session.accountId}`, message },
      },
    });
    const signatureMap = (result as { signatureMap?: unknown } | null)?.signatureMap;
    if (
      typeof signatureMap !== 'string' ||
      !proto.SignatureMap.decode(unb64(signatureMap)).sigPair?.length
    )
      throw new Error('the wallet returned no signatureMap');
    return signatureMap;
  };
}

// ── the WalletConnect session ───────────────────────────────────────────────────────────────────────────────────
let client: Promise<SignClient> | undefined;
const ended = new Set<string>();

function signClient(): Promise<SignClient> {
  if (!walletConnectProjectId) return Promise.reject(new Error('WalletConnect is not configured'));
  return (client ??= SignClient.init({
    projectId: walletConnectProjectId,
    metadata: {
      name: 'Recharge',
      description: 'Pay for eSIM data with USDC',
      url: window.location.origin,
      icons: [`${window.location.origin}/icons/icon-192.png`],
    },
  }).then((c) => {
    // an account or chain switch ends our use of the session: the next payment pairs again (fail closed)
    const end = ({ topic }: { topic: string }) => ended.add(topic);
    c.on('session_event', end);
    c.on('session_delete', end);
    c.on('session_expire', end);
    return c;
  }));
}

/** The one account a session approved on `chain`, or undefined when it approved anything else. */
export function sessionAccount(
  s: Pick<SessionTypes.Struct, 'namespaces'>,
  chain: HederaChain,
): string | undefined {
  const accounts = s.namespaces.hedera?.accounts ?? [];
  if (accounts.length !== 1) return undefined;
  const [ns, ref, id] = accounts[0]!.split(':');
  return `${ns}:${ref}` === chain && id && HEDERA_ID.test(id) ? id : undefined;
}

export interface HashPackConnect {
  /** The pairing URI for the QR / deep link; undefined when a live session was reused. */
  uri?: string;
  session: Promise<HashPackSession>;
}

/** Reuses a live session on `chain`, else proposes transaction and message signing together. */
export async function connectHashPack(chain: HederaChain): Promise<HashPackConnect> {
  const c = await signClient();
  const live = c.session
    .getAll()
    .find(
      (s) =>
        !ended.has(s.topic) &&
        s.expiry * 1000 > Date.now() &&
        sessionAccount(s, chain) &&
        supportsNativeMethods(s),
    );
  if (live)
    return {
      session: Promise.resolve({
        topic: live.topic,
        chain,
        accountId: sessionAccount(live, chain)!,
      }),
    };
  const { uri, approval } = await c.connect({
    optionalNamespaces: {
      hedera: {
        chains: [chain],
        methods: [SIGN, SIGN_MESSAGE],
        events: ['chainChanged', 'accountsChanged'],
      },
    },
  });
  return {
    ...(uri ? { uri } : {}),
    session: approval().then((s) => {
      const accountId = sessionAccount(s, chain);
      if (!accountId) throw new Error(`HashPack did not approve exactly one ${chain} account`);
      if (!supportsNativeMethods(s))
        throw new Error('HashPack must approve transaction and message signing');
      return { topic: s.topic, chain, accountId };
    }),
  };
}

export function supportsNativeMethods(session: Pick<SessionTypes.Struct, 'namespaces'>): boolean {
  const methods = session.namespaces.hedera?.methods ?? [];
  return methods.includes(SIGN) && methods.includes(SIGN_MESSAGE);
}

export async function signHashPackMessage(
  session: HashPackSession,
  message: string,
): Promise<string> {
  const c = await signClient();
  return hashPackMessageSigner(
    session,
    (request) => c.request(request),
    () => !ended.has(session.topic),
  )(message);
}

/** The PaymentSigner for a connected session. */
export async function hashPackPaySigner(
  session: HashPackSession,
  allow: readonly AcceptTerm[],
  hooks: SignerHooks = {},
): Promise<HashPackPaySigner> {
  const c = await signClient();
  const signer = hashPackSigner(
    session,
    (p) => c.request(p),
    () => !ended.has(session.topic),
  );
  return new HashPackPaySigner(signer, session.chain, allow, hooks);
}

/** HashPack's universal link (it has no custom scheme); opening it on a phone hands the pairing to the app. */
export const hashPackLink = (uri?: string): string =>
  `https://link.hashpack.app/wc${uri ? `?uri=${encodeURIComponent(uri)}` : ''}`;
