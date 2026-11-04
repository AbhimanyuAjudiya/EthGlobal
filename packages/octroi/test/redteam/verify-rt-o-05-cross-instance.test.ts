/**
 * Red-team verification variant for RT-O-05 (settlement marker `claim:HMAC('settle' ‖ network ‖ tx)`, A-33): the
 * regression races two decide() calls in one deps object. Here: 8 concurrent requests for ONE signed payment split
 * across two API instances (separate deps, one shared networked ledger, one shared front-running relayer), and a
 * relayer whose recovery answer spells the same transaction hash in a different letter case. Property: one transfer
 * on chain ⇒ at most one serve-paid.
 */
import { describe, expect, it } from 'vitest';

import { InMemoryLedger, type PaymentRail } from '@ethglobal/adapters';
import { fakeClock, paymentPayload } from '@ethglobal/adapters/testing';
import { NETWORKS } from '@ethglobal/protocol/ids';
import type { PaymentPayload, PaymentRequirements } from '@ethglobal/protocol/schemas';

import { buildAccepts, decide, type Decision } from '../../src/index.js';
import { deps, resource, type TestDeps } from '../helpers.js';
import { networked } from './rt-helpers.js';

/** A self-run relayer: first settle submits; a concurrent / later duplicate is "recovered" (success, same tx). */
function relayer(recoveredCase: (tx: string) => string): PaymentRail & { submissions: number } {
  const executed = new Map<string, string>();
  const auth = (p: PaymentPayload) =>
    (p.payload as { authorization: { from: string; nonce: string } }).authorization;
  const rail = {
    submissions: 0,
    createPaymentRequirement: () => {
      throw new Error('unused');
    },
    verify: async (p: PaymentPayload) => ({ isValid: true as const, payer: auth(p).from }),
    settle: async (p: PaymentPayload) => {
      const a = auth(p);
      const id = `${a.from}:${a.nonce}`;
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 3)));
      const found = executed.get(id);
      if (found) {
        return {
          success: true as const,
          transaction: recoveredCase(found),
          network: NETWORKS.anvil,
          payer: a.from,
        };
      }
      rail.submissions += 1;
      const tx = `0x${'ab'.repeat(31)}${String(rail.submissions).padStart(2, '0')}`;
      executed.set(id, tx);
      return { success: true as const, transaction: tx, network: NETWORKS.anvil, payer: a.from };
    },
  };
  return rail;
}

const offer = (d: TestDeps): PaymentRequirements =>
  buildAccepts(d, 100, { sessionKeyRequired: false }).find((o) => o.network === NETWORKS.anvil)!;

async function race(
  recoveredCase: (tx: string) => string,
): Promise<{ rs: Decision[]; submissions: number }> {
  const clock = fakeClock();
  const base = new InMemoryLedger({ now: clock.now });
  const rail = relayer(recoveredCase);
  const instances = [0, 1].map(() => ({
    ...deps({}, clock),
    ledger: networked(base),
    payments: rail,
  }));
  const payment = paymentPayload(offer(instances[0]!));
  const rs = await Promise.all(
    Array.from({ length: 8 }, (_, i) => decide({ resource, mb: 100, payment }, instances[i % 2]!)),
  );
  return { rs, submissions: rail.submissions };
}

describe('verify RT-O-05: one signed payment, two instances, eight requests', () => {
  it.each([
    ['same spelling', (tx: string) => tx],
    ['upper-cased recovery', (tx: string) => `0x${tx.slice(2).toUpperCase()}`],
  ])('%s ⇒ one submission, at most one serve-paid (20 rounds)', async (_name, recoveredCase) => {
    for (let round = 0; round < 20; round += 1) {
      const { rs, submissions } = await race(recoveredCase);
      expect(submissions).toBe(1);
      expect(rs.filter((r) => r.kind === 'serve-paid').length).toBeLessThanOrEqual(1);
      for (const r of rs)
        if (r.kind === 'deny') expect(['replay', 'invalid-payment']).toContain(r.reason);
    }
  });
});
