/** T-44 / red team AG8 — balance is a physical cap; HCS receipts are small, valid and carry no secrets. */
import { describe, expect, it } from 'vitest';

import { MockConsensusLog } from '@ethglobal/adapters';
import { fakeClock } from '@ethglobal/adapters/testing';
import { sha256Hex } from '@ethglobal/crypto';
import { decodeHcsMessage, HCS_MAX_BYTES } from '@ethglobal/protocol/schemas';

import { tick } from '../../src/tick.js';
import { buyOnce, harness, HEDERA_ACCEPT, hederaPayer, KEY, seed, skips } from '../helpers.js';

describe('T-44 balance and receipts (AG8)', () => {
  it('EVM balanceUsd6() < value → no signature, agent.skip insufficient-balance', async () => {
    const h = await harness({ evmBalance: 399_999n });
    const out = await buyOnce(h);
    expect(out).toMatchObject({ skipped: 'insufficient-balance', signatures: 0 });
    expect(skips(h).some((s) => s.reason === 'insufficient-balance')).toBe(true);
  });

  it('Hedera balanceUsd6() < value → no transaction built', async () => {
    const hp = hederaPayer({ balance: 1n });
    const h = await harness({ api: { accepts: [HEDERA_ACCEPT] }, payers: () => [hp] });
    expect(await buyOnce(h)).toMatchObject({ skipped: 'insufficient-balance', signatures: 0 });
  });

  it('the HCS agent-topup message is ≤ 1024 bytes, schema-valid, carries sha256(key) and nothing secret', async () => {
    const h = await harness();
    await buyOnce(h);
    const [text] = h.consensus.messages(h.config.hcsTopic);
    expect(text).toBeDefined();
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(HCS_MAX_BYTES);
    const msg = decodeHcsMessage(text!);
    expect(msg).toMatchObject({
      t: 'agent-topup',
      ent: sha256Hex(KEY),
      uaid: h.agent.uaid,
      reason: 'threshold',
    });
    expect(text).not.toContain(KEY);
    expect(text).not.toMatch(/lpa|iccid|nullifier|pin/i);
  });

  it('an HCS submit failure is logged and does not cause a second purchase', async () => {
    const clock = fakeClock();
    const broken = new MockConsensusLog({ now: clock.now });
    broken.submit = async () => Promise.reject(new Error('INVALID_TOPIC_ID'));
    const h = await harness({ clock, consensus: broken });
    await seed(h.ledger, h.clock.now, { mbUsed: 850 }); // after one step: 250 MB left, above the threshold
    const r = await tick(h.agent.deps, KEY);
    expect(r.bought).toBeDefined();
    expect(r.bought?.hcsSequence).toBeUndefined();
    expect(h.log.lines.some((l) => l.obj.event === 'degraded' && l.obj.what === 'hcs-submit')).toBe(
      true,
    );
    h.clock.advance(5_000);
    await tick(h.agent.deps, KEY);
    expect(h.api.settled).toHaveLength(1);
    expect(h.signatures()).toBe(1);
  });
});
