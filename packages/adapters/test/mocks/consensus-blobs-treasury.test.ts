import { describe, expect, it } from 'vitest';

import { MemoryBlobStore, MockConsensusLog, MockTreasury } from '../../src/index.js';
import {
  anvilAccounts,
  describeBlobStore,
  describeConsensusLog,
  describeTreasury,
  fakeClock,
  T0,
} from '../../src/testing/index.js';

describeConsensusLog(
  'MockConsensusLog',
  async () => new MockConsensusLog({ now: fakeClock().now }),
);
describeBlobStore('MemoryBlobStore', async () => new MemoryBlobStore());
describeTreasury('MockTreasury (eip155:31337)', async () => ({
  treasury: new MockTreasury(),
  network: 'eip155:31337',
  to: anvilAccounts[5],
}));
describeTreasury('MockTreasury (hedera:testnet)', async () => ({
  treasury: new MockTreasury(),
  network: 'hedera:testnet',
  to: '0.0.5005',
}));

describe('mock specifics', () => {
  it('MockConsensusLog: consensusAt = now, txId mock@<seq>, messages() dump', async () => {
    const log = new MockConsensusLog({ now: () => T0 });
    await expect(log.submit('0.0.1', 'a')).resolves.toEqual({
      sequence: 1,
      consensusAt: T0,
      txId: 'mock@1',
    });
    await log.submit('0.0.2', 'b');
    expect(log.messages('0.0.1')).toEqual(['a']);
    expect(log.messages('0.0.3')).toEqual([]);
  });

  it('MemoryBlobStore: content addressed, returns copies; too large rejected', async () => {
    const store = new MemoryBlobStore();
    const a = await store.put(new Uint8Array([1, 2]), 'application/octet-stream');
    expect((await store.put(new Uint8Array([1, 2]), 'application/octet-stream')).ref).toBe(a.ref);
    const got = (await store.get(a.ref))!;
    got[0] = 9;
    expect(await store.get(a.ref)).toEqual(new Uint8Array([1, 2]));
    await expect(
      store.put(new Uint8Array(1024 * 1024 + 1), 'application/json'),
    ).rejects.toMatchObject({ code: 'too_large' });
  });

  it('MockTreasury: deterministic tx, refunds() log, failNext once, float and unknown network', async () => {
    const make = () => new MockTreasury({ balances: { 'eip155:31337': 1_000_000n } });
    const t = make();
    const input = {
      network: 'eip155:31337',
      to: anvilAccounts[5],
      usd6: 400_000n,
      memo: 'reclaim',
    };
    const { tx } = await t.refund(input);
    expect((await make().refund(input)).tx).toBe(tx);
    expect(t.refunds()).toEqual([{ ...input, tx }]);
    t.failNext = true;
    await expect(t.refund(input)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(t.refund(input)).resolves.toHaveProperty('tx');
    await expect(t.refund({ ...input, usd6: 300_000n })).rejects.toMatchObject({
      code: 'unavailable',
    });
    await expect(t.balanceUsd6('eip155:1')).rejects.toMatchObject({ code: 'unsupported_network' });
    await expect(t.refund({ ...input, network: 'eip155:1' })).rejects.toMatchObject({
      code: 'unsupported_network',
    });
  });
});
