/** T-30 / red team AG1 — the daily cap holds under races, receipt lag and big steps. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { InMemoryLedger } from '@ethglobal/adapters';
import { fakeClock } from '@ethglobal/adapters/testing';
import { sha256Hex } from '@ethglobal/crypto';
import { ReceiptStore } from '@ethglobal/octroi';
import { dayBucket, keys } from '@ethglobal/protocol/ids';

import { Journal } from '../../src/journal.js';
import { LedgerReads } from '../../src/reads.js';
import { tick, triggerKey } from '../../src/tick.js';
import {
  EVM_ACCEPT,
  harness,
  HEDERA_ACCEPT,
  hederaPayer,
  KEY,
  seed,
  setUsage,
} from '../helpers.js';

describe('T-30 agent cap (AG1)', () => {
  it('two ticks for one key at once → one purchase; the other is "busy"', async () => {
    const h = await harness();
    await seed(h.ledger, h.clock.now, { mbUsed: 900 });
    const [a, b] = await Promise.all([tick(h.agent.deps, KEY), tick(h.agent.deps, KEY)]);
    expect([a.skipped, b.skipped].filter(Boolean)).toEqual(['busy']);
    expect(h.api.settled).toHaveLength(1);
    const buys = (await new Journal(h.stateDir).read()).filter((l) => l.event === 'buy');
    expect(buys).toHaveLength(1);
  });

  it('two agent processes over one ledger and one .agent dir → at most one purchase per trigger', async () => {
    const clock = fakeClock();
    const ledger = new InMemoryLedger({ now: clock.now });
    const a = await harness({ clock, ledger });
    const b = await harness({ clock, ledger, stateDir: a.stateDir });
    await seed(ledger, clock.now, { mbUsed: 900 });
    const results = await Promise.all([tick(a.agent.deps, KEY), tick(b.agent.deps, KEY)]);
    expect(results.filter((r) => r.bought)).toHaveLength(1);
    expect(results.find((r) => !r.bought)?.skipped).toBe('trigger-in-flight');
    expect(a.signatures() + b.signatures()).toBe(1);
  });

  it('RT-G-01 — a trigger record another process is still writing (empty file) ⇒ this tick backs off, no signature', async () => {
    const h = await harness();
    const e = await seed(h.ledger, h.clock.now, { mbUsed: 900 });
    const triggers = join(h.stateDir, 'triggers');
    await mkdir(triggers, { recursive: true });
    const name = `${sha256Hex(triggerKey(KEY, e, 'threshold')).slice(2)}.json`;
    await writeFile(join(triggers, name), '');
    expect((await tick(h.agent.deps, KEY)).skipped).toBe('trigger-in-flight');
    expect(h.signatures()).toBe(0);
  });

  it("receipt write lag: the ledger still shows $0 spent, the agent's own record blocks the next step", async () => {
    const h = await harness({
      reads: (ledger, now) => {
        const real = new LedgerReads(ledger, now);
        real.spentTodayUsd6 = async () => 0n;
        return real;
      },
    });
    await seed(h.ledger, h.clock.now, { mbUsed: 900, policy: { maxUsd6PerDay: '400000' } });
    expect((await tick(h.agent.deps, KEY)).bought).toBeDefined();
    await setUsage(h.ledger, h.clock.now, 1100); // a new crossing (mbTotal moved to 1100)
    const second = await tick(h.agent.deps, KEY);
    expect(second.verdict).toEqual({ buy: false, reason: 'cap' });
    expect(h.api.settled).toHaveLength(1);
  });

  it('stepMb 300 with $8.90 already spent of $10 → no buy (8.90 + 1.20 > 10)', async () => {
    const h = await harness();
    await seed(h.ledger, h.clock.now, { mbUsed: 950, policy: { stepMb: 300 } });
    await new ReceiptStore(h.ledger, h.clock.now).add({
      v: 1,
      key: keys.receipt('eip155:31337', '0xprior'),
      kind: 'agent-topup',
      entitlementKeyHash: sha256Hex(KEY),
      mb: 2200,
      usd6: '8900000',
      network: 'eip155:31337',
      tx: '0xprior',
      at: h.clock.now(),
    });
    expect(dayBucket(h.clock.now())).toBeGreaterThan(0);
    const r = await tick(h.agent.deps, KEY);
    expect(r.verdict).toEqual({ buy: false, reason: 'cap' });
    expect(h.signatures()).toBe(0);
  });

  it('paused policy → zero signatures even with mbUsed == mbTotal and an expiry inside the lead', async () => {
    const h = await harness({
      api: { accepts: [HEDERA_ACCEPT, EVM_ACCEPT] },
      payers: (evm) => [hederaPayer(), evm],
    });
    await seed(h.ledger, h.clock.now, {
      mbUsed: 1000,
      expiresAt: h.clock.now() + 60_000,
      policy: { paused: true },
    });
    for (let i = 0; i < 5; i += 1) {
      expect((await tick(h.agent.deps, KEY)).verdict.reason).toBe('paused');
      h.clock.advance(5_000);
    }
    expect(h.signatures()).toBe(0);
  });

  it('AGENT_DRY_RUN=1 → zero sign() calls on both payers; the journal says would-buy', async () => {
    const h = await harness({
      env: { AGENT_DRY_RUN: '1' },
      api: { accepts: [HEDERA_ACCEPT, EVM_ACCEPT] },
      payers: (evm) => [hederaPayer(), evm],
    });
    const spies = h.agent.payers.map((p) => vi.spyOn(p, 'sign'));
    await seed(h.ledger, h.clock.now, { mbUsed: 1000 });
    await tick(h.agent.deps, KEY);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    const journal = await new Journal(h.stateDir).read();
    expect(journal.find((l) => l.event === 'would-buy')).toMatchObject({
      mb: 100,
      usd6: '400000',
    });
  });
});
