/**
 * The agent's spending history, read by the browser straight from the Arkiv node, not through our API: one
 * `arkiv_query` over plain JSON-RPC (no Arkiv SDK in the bundle). Only sha256(plan key) leaves the device. A row
 * counts only if our API's writer created it (`$creator`, T-79: anyone can write a look-alike entity) and its
 * payload passes receiptSchema and matches what was asked for (kind, plan hash); anything else is dropped.
 */
import { hexToBytes, isHex, toHex } from 'viem';
import { z } from 'zod';

import { httpJson } from '@ethglobal/protocol/http';
import { receiptSchema, type Receipt } from '@ethglobal/protocol/schemas';

import { config } from './env';

/** Newest first, at most this many (the node's page cap is 100). */
const ARKIV_HISTORY_LIMIT = 50;

export type AgentTopUp = Receipt & { entityKey: string };

/** sha256(plan key) as the API writes `entitlementKeyHash` (`sha256Hex` over UTF-8): lowercase 0x-hex. */
export async function planHash(planKey: string): Promise<string> {
  return toHex(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(planKey))),
  );
}

/** The JSON-RPC body, exactly as sent (and shown under "How this is read"). The node wants `AND`, not `&&`. */
export function topUpsRequest(hash: string, writer: string = config.arkivWriter) {
  const query =
    `$creator = addr(${writer}) AND type = str('receipt') AND entitlementKeyHash = str('${hash}')` +
    ` AND receiptKind = str('agent-topup') ORDER BY createdAtMs:u64 DESC`;
  const options = {
    select: { key: true, creator: true, attributes: { payload: true } },
    limit: toHex(ARKIV_HISTORY_LIMIT),
  };
  return { jsonrpc: '2.0', id: 1, method: 'arkiv_query', params: [query, options] };
}

const rowSchema = z.object({
  key: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  creator: z.string(),
  attributes: z.array(z.object({ name: z.string(), value: z.unknown() })),
});

function decodeRow(raw: unknown, hash: string, writer: string): AgentTopUp | null {
  const row = rowSchema.safeParse(raw);
  if (!row.success || row.data.creator.toLowerCase() !== writer.toLowerCase()) return null;
  const payload = row.data.attributes.find((a) => a.name === 'payload')?.value;
  if (typeof payload !== 'string' || !isHex(payload)) return null;
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(hexToBytes(payload)));
  } catch {
    return null;
  }
  const receipt = receiptSchema.safeParse(json);
  if (!receipt.success || receipt.data.kind !== 'agent-topup') return null;
  if (receipt.data.entitlementKeyHash.toLowerCase() !== hash.toLowerCase()) return null;
  return { ...receipt.data, entityKey: row.data.key };
}

/** An `arkiv_query` result → the valid agent top-ups, newest first. Throws when it is not a result at all. */
export function decodeTopUps(
  result: unknown,
  hash: string,
  writer: string = config.arkivWriter,
): AgentTopUp[] {
  const { data } = z.object({ data: z.array(z.unknown()) }).parse(result);
  return data
    .flatMap((raw) => decodeRow(raw, hash, writer) ?? [])
    .sort((a, b) => b.at - a.at)
    .slice(0, ARKIV_HISTORY_LIMIT);
}

/** One query to the Arkiv node; a timeout, an HTTP error or a JSON-RPC error throws ("Couldn't reach Arkiv"). */
export async function readTopUps(hash: string): Promise<AgentTopUp[]> {
  const { data } = await httpJson<{ result?: unknown } | undefined>(config.arkivRpc, {
    body: topUpsRequest(hash),
  });
  return decodeTopUps(data?.result, hash);
}
