import { toHex } from 'viem';
import { describe, expect, it } from 'vitest';

import { sha256Hex } from '@ethglobal/crypto';

import { decodeTopUps, planHash, topUpsRequest } from '../lib/arkiv-read';

const WRITER = '0xC3358be9F35fDF5C8e1922be7376980C93734d3c';
const PLAN = 'paid:0x27e2ca12f288a7d1c549c53ca0e01e7ce2b32c25:0x01';

/** A receipt payload as the API writes it (the live top-up of Fri 6 Nov 06:14 IST, as an agent-topup). */
const receipt = (hash: string, over: Record<string, unknown> = {}) => ({
  v: 1,
  key: 'rcpt:hedera:testnet:0.0.9185802@1793925870.465901542',
  kind: 'agent-topup',
  entitlementKeyHash: hash,
  mb: 100,
  usd6: '400000',
  network: 'hedera:testnet',
  tx: '0.0.9185802@1793925870.465901542',
  payer: '0.0.11320978',
  hcs: { topic: '0.0.11322448', sequence: 7 },
  at: 1793925901135,
  ...over,
});

/** One row in the shape rabdi answers `arkiv_query` (select key, creator, attributes.payload; recorded 6 Nov 2026). */
const row = (n: number, payload: unknown, creator = WRITER.toLowerCase()) => ({
  key: `0x${String(n).repeat(64)}`,
  creator,
  attributes: [
    {
      name: 'payload',
      type: 'bytes',
      value: toHex(typeof payload === 'string' ? payload : JSON.stringify(payload)),
    },
  ],
});

describe('arkiv-read: the browser reads the agent top-ups from Arkiv', () => {
  it('hashes the plan key exactly as the API writes entitlementKeyHash', async () => {
    expect(await planHash(PLAN)).toBe(sha256Hex(PLAN));
  });

  it('asks for agent-topup receipts of this plan, created by our writer only', async () => {
    const hash = await planHash(PLAN);
    const body = topUpsRequest(hash, WRITER);
    const [query, options] = body.params;
    expect(body.method).toBe('arkiv_query');
    expect(query).toContain(`$creator = addr(${WRITER})`);
    expect(query).toContain("type = str('receipt')");
    expect(query).toContain(`entitlementKeyHash = str('${hash}')`);
    expect(query).toContain("receiptKind = str('agent-topup')");
    expect(query).not.toContain('&&'); // the node rejects it
    expect(options).toMatchObject({ limit: '0x32' });
  });

  it('keeps valid rows newest first and drops forgeries, bad payloads, other kinds and other plans', async () => {
    const hash = await planHash(PLAN);
    const older = receipt(hash, { at: 1793925901135 });
    const newer = receipt(hash, { at: 1793929501135, tx: '0.0.9185802@1793929470.1' });
    const rows = decodeTopUps(
      {
        data: [
          row(1, older),
          row(2, newer),
          row(
            3,
            receipt(hash, { at: 1793999999999 }),
            '0x000000000000000000000000000000000000dead',
          ),
          row(4, '{not json'),
          row(5, receipt(hash, { at: undefined })),
          row(6, receipt(hash, { kind: 'topup' })),
          row(7, receipt(`0x${'f'.repeat(64)}`)),
          { key: 'not-a-key', creator: WRITER, attributes: [] },
        ],
        blockNumber: '0x421c5',
      },
      hash,
      WRITER,
    );
    expect(rows.map((r) => [r.entityKey, r.at])).toEqual([
      [`0x${'2'.repeat(64)}`, newer.at],
      [`0x${'1'.repeat(64)}`, older.at],
    ]);
    expect(rows[0]).toMatchObject({ kind: 'agent-topup', mb: 100, usd6: '400000' });
  });

  it('throws when the answer is not a query result (shown as "Couldn\'t reach Arkiv")', () => {
    expect(() => decodeTopUps(undefined, '0x00', WRITER)).toThrow();
  });
});
