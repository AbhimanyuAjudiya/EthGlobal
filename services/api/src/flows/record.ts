/** Receipts (ledger) and their HCS twins: the accounting trail every fulfilment leaves (brief §4.2 step 5). */
import { randomUUID } from 'node:crypto';

import { sha256Hex } from '@ethglobal/crypto';
import { keys } from '@ethglobal/protocol/ids';
import { encodeHcsMessage, type HcsMessage, type Receipt } from '@ethglobal/protocol/schemas';

import type { Deps } from '../deps.js';

type HcsBody = HcsMessage extends infer M
  ? M extends HcsMessage
    ? Omit<M, 'v' | 'at' | 'svc' | 'ent'>
    : never
  : never;
export type ReceiptDraft = Omit<Receipt, 'v' | 'key' | 'entitlementKeyHash' | 'at' | 'hcs'> & {
  key?: string;
};

export interface Recorded {
  hcs: { topic: string; sequence: number } | undefined;
  receiptKey: string | undefined;
}

/** `rcpt:<network>:<tx>` when a transaction exists, else `rcpt:ledger:<uuid>` (INTERFACES §1.4). */
export const receiptKey = (draft: Pick<ReceiptDraft, 'network' | 'tx'>): string =>
  draft.network !== undefined && draft.tx !== undefined && draft.tx !== ''
    ? keys.receipt(draft.network, draft.tx)
    : `rcpt:ledger:${randomUUID()}`;

/** HCS submit; a failure is logged, never fatal (HCS is a receipt, not a gate). */
export async function submitHcs(
  deps: Deps,
  entitlementKey: string,
  body: HcsBody,
): Promise<Recorded['hcs']> {
  const topic = deps.env.HCS_TOPIC_ID;
  try {
    const message = encodeHcsMessage({
      v: 1,
      at: new Date(deps.now()).toISOString(),
      svc: 'api',
      ent: sha256Hex(entitlementKey),
      ...body,
    });
    const { sequence } = await deps.metrics.timed('hcs_ms', () =>
      deps.adapters.consensus.submit(topic, message),
    );
    return { topic, sequence };
  } catch (error) {
    deps.logger.error(
      { event: 'ledger.op', op: 'hcs.submit', type: body.t, err: errName(error) },
      'hcs submit failed',
    );
    return undefined;
  }
}

/** The receipt entity, written with `entitlementKeyHash = sha256(entitlementKey)` (never the key, T-44). Throws. */
export async function addReceipt(
  deps: Deps,
  entitlementKey: string,
  draft: ReceiptDraft,
  hcs?: Recorded['hcs'],
): Promise<string> {
  const { key, ...rest } = draft;
  const receipt: Receipt = {
    v: 1,
    key: key ?? receiptKey(draft),
    entitlementKeyHash: sha256Hex(entitlementKey),
    at: deps.now(),
    ...stripUndefined(rest),
    ...(hcs ? { hcs } : {}),
  };
  await deps.stores.receipts.add(receipt);
  return receipt.key;
}

/** HCS then the receipt (carrying the HCS reference); a receipt failure is logged and the response still goes out. */
export async function record(
  deps: Deps,
  entitlementKey: string,
  draft: ReceiptDraft,
  body: HcsBody,
): Promise<Recorded> {
  const hcs = await submitHcs(deps, entitlementKey, body);
  try {
    return { hcs, receiptKey: await addReceipt(deps, entitlementKey, draft, hcs) };
  } catch (error) {
    deps.logger.error(
      { event: 'ledger.op', op: 'receipt.add', kind: draft.kind, err: errName(error) },
      'receipt write failed',
    );
    return { hcs, receiptKey: undefined };
  }
}

export const errName = (error: unknown): string =>
  error instanceof Error
    ? `${error.name}${'code' in error ? `:${String((error as { code: unknown }).code)}` : ''}`
    : 'error';

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
