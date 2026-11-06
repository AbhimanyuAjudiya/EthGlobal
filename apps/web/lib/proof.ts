/**
 * The evidence after an action, for a judge (or anyone) to check without trusting the screen: what the API answered,
 * the x402 terms the wallet signed and their settlement, the wallet's own transactions — as items grouped by partner
 * (Hedera, Base, World, Arkiv, ENS), each a label, a short value, a copy and a link — plus the whole response as
 * pretty JSON. Pure: no I/O, no storage. Redaction comes first: an activation code (sealed or opened), a PIN and any
 * private or session key never reach the output, and plan keys are shortened.
 */
import type { PaymentRequirements, SettleResult } from '@ethglobal/protocol/schemas';

import {
  arkivEntityUrl,
  config,
  contractUrl,
  explorerName,
  explorerTemplate,
  hcsTopicUrl,
} from './env';
import { clockIst, dayLabel, moneyUsdc } from './format';

import type { StringKey } from '../i18n/strings';

export type Partner = 'hedera' | 'base' | 'chain' | 'world' | 'arkiv' | 'ens' | 'api';
/** The order the panel shows them in. */
export const PARTNERS: readonly Partner[] = [
  'hedera',
  'base',
  'chain',
  'world',
  'arkiv',
  'ens',
  'api',
];

export interface ProofItem {
  partner: Partner;
  label: StringKey;
  /** hash: shown short, copied whole; text: as is; key: `value` is a string key to translate; code: a command. */
  kind: 'hash' | 'text' | 'key' | 'code';
  value: string;
  href?: string;
  /** The link's name: "HashScan", "Arkiv". */
  site?: string;
}

export interface Proof {
  ok: boolean;
  items: ProofItem[];
  /** The API's answer (or the error, or the transactions), redacted, as pretty JSON. */
  raw: string;
}

export interface ProofInput {
  /** The API's 2xx body. */
  response?: unknown;
  /** The HTTP status, when the caller has it (201, 202). */
  status?: number;
  /** A failure: an ApiError (status, code, message, details, requestId) or anything thrown. */
  error?: unknown;
  /** CAIP-2 of the chain this action's own transaction and signature belong to (a DataDrop claim, a sponsor call). */
  network?: string;
  /** The decoded x402 headers: the accepts entry the wallet signed, the settlement (PAYMENT-RESPONSE). */
  x402?: { accepted?: PaymentRequirements | undefined; settlement?: SettleResult | undefined };
  /** The wallet's own transactions for this action. */
  txs?: readonly { label: StringKey; hash: string; network: string }[];
  /** The contract the action called (DataDrop). */
  contract?: { address: string; network: string };
  /** A gift: the ENS name and the address it resolved to. */
  ens?: { name: string; address?: string };
  /** A World ID claim: add the verification level and the backend's decision. */
  world?: boolean;
  /** An EIP-712 signature the API checked (AgentPolicy): its domain's chain. */
  signedOn?: number;
}

const DROP =
  /^(sealedLpa|lpa|activationCode|ac|pins?|seed|mnemonic|sk|session(Pub)?Key|spk)$|secret|private/i;
const SHORTEN = /^(entitlementKey|auditKey|holder)$/;
const LPA = /LPA:1\$/i;
const PIN = /^\d{4} ?\d{4} ?\d{4} ?\d{4}$/;

const short = (v: string): string => (v.length > 16 ? `${v.slice(0, 8)}…${v.slice(-4)}` : v);

/** A JSON-safe copy without activation codes, PINs or private/session keys; plan and audit keys shortened. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 12) return '…';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return LPA.test(value) || PIN.test(value) ? '[redacted]' : value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).flatMap(([k, v]) =>
        DROP.test(k)
          ? []
          : [[k, SHORTEN.test(k) && typeof v === 'string' ? short(v) : redact(v, depth + 1)]],
      ),
    );
  return value;
}

/** Which partner a chain belongs to: Hedera (native and its EVM, where DataDrop lives), Base, or the local chain. */
export function partnerOf(network: string): Partner {
  if (network.startsWith('hedera:') || network === 'eip155:296' || network === 'eip155:295')
    return 'hedera';
  if (network === 'eip155:84532' || network === 'eip155:8453') return 'base';
  return 'chain';
}

const field = (o: unknown, k: string): unknown =>
  o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined;
const str = (o: unknown, k: string): string | undefined => {
  const v = field(o, k);
  return typeof v === 'string' && v ? v : undefined;
};

/** A transaction on its chain's explorer (BaseScan, HashScan); no link on the local chain. */
function txItem(label: StringKey, hash: string, network: string): ProofItem {
  const template = explorerTemplate(network);
  const site = explorerName(network);
  return {
    partner: partnerOf(network),
    label,
    kind: 'hash',
    value: hash,
    ...(template ? { href: template.replace('{hash}', hash) } : {}),
    ...(site ? { site } : {}),
  };
}

/** The one-line read of an Arkiv entity, straight from the node (arkiv_getEntity; no access key for reads). */
export const arkivRead = (key: string): string =>
  `curl -s ${config.arkivRpc} -H 'content-type: application/json' -d '${JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'arkiv_getEntity',
    params: [key],
  })}'`;

interface ErrorBody {
  status?: number;
  error: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

function errorBody(error: unknown): ErrorBody {
  const status = field(error, 'status');
  const code = field(error, 'code');
  const requestId = str(error, 'requestId');
  return {
    ...(typeof status === 'number' ? { status } : {}),
    // an API error's code ("payment_required", "network"), else what was thrown ("WrongChainError")
    error: typeof code === 'string' ? code : error instanceof Error ? error.name : 'error',
    message: error instanceof Error ? error.message : String(error),
    ...(field(error, 'details') === undefined ? {} : { details: field(error, 'details') }),
    ...(requestId ? { requestId } : {}),
  };
}

export function buildProof(input: ProofInput): Proof {
  const { response: r, x402 } = input;
  const items: ProofItem[] = [];
  const add = (item: ProofItem | false | '' | undefined) => {
    if (item) items.push(item);
  };

  const accepted = x402?.accepted;
  if (accepted) {
    const p = partnerOf(accepted.network);
    const feePayer = field(accepted.extra, 'feePayer');
    add({ partner: p, label: 'pay.hNetwork', kind: 'text', value: accepted.network });
    add({ partner: p, label: 'proof.asset', kind: 'hash', value: accepted.asset });
    add({
      partner: p,
      label: 'pay.hAmount',
      kind: 'text',
      value: `${moneyUsdc(accepted.amount)} · ${accepted.amount}`,
    });
    add({ partner: p, label: 'pay.hPayTo', kind: 'hash', value: accepted.payTo });
    add(
      typeof feePayer === 'string' && {
        partner: p,
        label: 'pay.hFeePayer',
        kind: 'hash',
        value: feePayer,
      },
    );
  }
  const settlement = x402?.settlement ?? (field(r, 'settlement') as SettleResult | undefined);
  if (settlement?.success) {
    add(txItem('proof.settlement', settlement.transaction, settlement.network));
    add({
      partner: partnerOf(settlement.network),
      label: 'proof.payer',
      kind: 'hash',
      value: settlement.payer,
    });
  } else if (settlement) {
    add({
      partner: partnerOf(settlement.network),
      label: 'proof.reason',
      kind: 'text',
      value: settlement.errorReason,
    });
  }

  const network = input.network ?? `eip155:${config.chainId}`;
  const claimTx = str(r, 'claimTx');
  add(claimTx && txItem('proof.claimTx', claimTx, network));
  for (const tx of input.txs ?? []) add(txItem(tx.label, tx.hash, tx.network));
  const refundTx = str(r, 'tx');
  const refundNetwork = str(r, 'network');
  add(refundTx && refundNetwork && txItem('proof.refundTx', refundTx, refundNetwork));
  const refunded = str(r, 'refundedUsd6');
  add(
    refunded &&
      refundNetwork && {
        partner: partnerOf(refundNetwork),
        label: 'pay.hAmount',
        kind: 'text',
        value: moneyUsdc(refunded),
      },
  );
  const campaignId = str(r, 'id');
  add(
    campaignId && {
      partner: partnerOf(network),
      label: 'proof.campaign',
      kind: 'hash',
      value: campaignId,
    },
  );
  if (input.contract) {
    const href = contractUrl(input.contract.network, input.contract.address);
    add({
      partner: partnerOf(input.contract.network),
      label: 'proof.contract',
      kind: 'hash',
      value: input.contract.address,
      ...(href ? { href, site: explorerName(input.contract.network) ?? 'Explorer' } : {}),
    });
  }
  const owner = str(r, 'owner');
  add(owner && { partner: partnerOf(network), label: 'proof.signer', kind: 'hash', value: owner });
  add(
    input.signedOn !== undefined && {
      partner: partnerOf(`eip155:${input.signedOn}`),
      label: 'proof.domain',
      kind: 'text',
      value: `Recharge · eip155:${input.signedOn}`,
    },
  );
  const uaid = str(r, 'uaid');
  add(uaid && { partner: 'hedera', label: 'proof.uaid', kind: 'hash', value: uaid });

  const receipt = field(r, 'receipt');
  const hcs = field(receipt, 'hcs');
  const topic = str(hcs, 'topic');
  add(
    topic && {
      partner: 'hedera',
      label: 'issuing.hcs',
      kind: 'text',
      value: `${topic} · #${String(field(hcs, 'sequence'))}`,
      href: hcsTopicUrl(topic),
      site: 'HashScan',
    },
  );

  if (input.world) {
    const tier = str(r, 'tier');
    add(tier && { partner: 'world', label: 'proof.level', kind: 'text', value: tier });
    add(
      r !== undefined && {
        partner: 'world',
        label: 'proof.verifiedBy',
        kind: 'key',
        value: 'proof.backend',
      },
    );
    const decision =
      str(r, 'kind') === 'free'
        ? 'proof.free'
        : field(input.error, 'code') === 'payment_required'
          ? 'proof.pay'
          : undefined;
    add(decision && { partner: 'world', label: 'proof.decision', kind: 'key', value: decision });
  }
  const pass = str(field(r, 'pass'), 'state');
  add(
    pass &&
      pass !== 'none' && { partner: 'world', label: 'proof.agentPass', kind: 'text', value: pass },
  );

  const arkivKey = str(receipt, 'arkivKey');
  if (arkivKey) {
    const href = arkivEntityUrl(arkivKey);
    add({
      partner: 'arkiv',
      label: 'proof.entity',
      kind: 'hash',
      value: arkivKey,
      ...(href ? { href, site: 'Arkiv' } : {}),
    });
    const expiresAt = field(r, 'expiresAt') ?? field(r, 'claimBy');
    add(
      typeof expiresAt === 'number' && {
        partner: 'arkiv',
        label: 'proof.expires',
        kind: 'text',
        value: `${dayLabel(expiresAt)} ${clockIst(expiresAt)} IST`,
      },
    );
    add(
      href !== undefined && {
        partner: 'arkiv',
        label: 'proof.read',
        kind: 'code',
        value: arkivRead(arkivKey),
      },
    );
  }

  if (input.ens) {
    add({
      partner: 'ens',
      label: 'gift.name',
      kind: 'text',
      value: input.ens.name,
      href: `https://app.ens.domains/${encodeURIComponent(input.ens.name)}`,
      site: 'ENS',
    });
    add(
      input.ens.address !== undefined && {
        partner: 'ens',
        label: 'proof.resolvesTo',
        kind: 'hash',
        value: input.ens.address,
      },
    );
  }

  const failed = input.error !== undefined;
  const body = failed ? errorBody(input.error) : undefined;
  const status = failed ? body?.status : input.status;
  // the API's answer: its status, or an API error's code (a wallet or switch failure never reached the API)
  const answered = status !== undefined || typeof field(input.error, 'code') === 'string';
  add(
    answered && {
      partner: 'api',
      label: 'proof.status',
      kind: 'text',
      // a request that got no answer has no status (0): its code ("network") says so
      value: [status ? String(status) : '', body?.error ?? ''].filter(Boolean).join(' '),
    },
  );
  add(
    body?.requestId !== undefined && {
      partner: 'api',
      label: 'proof.requestId',
      kind: 'hash',
      value: body.requestId,
    },
  );

  const shown = body ?? r ?? (input.txs?.length ? { transactions: input.txs } : {});
  return {
    ok: !failed,
    // defence in depth: a value the redaction would change never leaves as an item either
    items: items.filter((item) => redact(item.value) === item.value),
    raw: JSON.stringify(redact(shown), null, 2),
  };
}
