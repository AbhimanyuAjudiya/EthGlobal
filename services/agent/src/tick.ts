/**
 * One decision for one entitlement (agent.md §3, normative). Every number the decision uses comes from the ledger
 * read (or, locally, the API's view of it), the agent's own state and /plans; nothing from an LLM, nothing from a
 * payload string (T-55). Order: ledger read → policy → spent today → stepPrice → shouldTopUp → step sold (/plans
 * paid.sizesMb) → (dry run) → trigger claim → buy → HCS receipt → notification.
 */
import { sha256Hex } from '@ethglobal/crypto';
import {
  policyFromWire,
  shouldTopUp,
  type TopUpPolicy,
  type TopUpVerdict,
} from '@ethglobal/octroi';
import { STEP_MB, dayBucket } from '@ethglobal/protocol/ids';
import type { Entitlement } from '@ethglobal/protocol/schemas';
import { priceUsd6, usd6FromWire, usd6ToWire } from '@ethglobal/protocol/units';

import { logEvent, safeError, type Log } from './log.js';

import type { BuyOutcome, Buyer } from './buyer.js';
import type { NotificationFacts } from './facts.js';
import type { AgentState, Journal } from './journal.js';
import type { Notifier } from './notifier.js';
import type { PassClient } from './pass.js';
import type { AgentReads, PlansCache } from './reads.js';
import type { ReceiptWriter } from './receipts.js';

export interface TickResult {
  key: string;
  verdict: TopUpVerdict;
  bought?: { mb: number; usd6: bigint; tx: string; network: string; hcsSequence?: number };
  skipped?: string;
  notification?: string;
}

export interface AgentDeps {
  reads: AgentReads;
  plans: Pick<PlansCache, 'get'>;
  buyer: Pick<Buyer, 'buy'>;
  receipts: Pick<ReceiptWriter, 'submit'>;
  journal: Pick<Journal, 'write'>;
  state: AgentState;
  now: () => number;
  log: Log;
  dryRun: boolean;
  /** AGENT_OWNER: when set, a policy owned by anyone else is not this agent's (agent.md §3 step 2). */
  owner?: string;
  /** Phrases a notification from facts after the decision; its text is stored, never read back. */
  notifier: Notifier;
  /** Keys with a tick in progress in this process (concurrency 1 per key). */
  inFlight: Set<string>;
  /** Last notified non-buy reason per key, so cap/paused notify on change, not every 5 s. */
  lastNotice?: Map<string, string>;
  /** The World ID Agent Pass checkpoint run when the API answers 403 pass_required (docs/WORLD_AGENT_PASS.md). */
  pass?: Pick<PassClient, 'checkpoint'>;
}

/** How far the clock may sit behind the newest purchase on file before the agent stops buying (RT-G-03). */
export const CLOCK_SKEW_MS = 60_000;

/** Shown when no verdict exists (nothing to decide on). */
const NO_VERDICT: TopUpVerdict = { buy: false, reason: 'ok' };

/**
 * Idempotency key of one purchase trigger (T-57). Expiry: once per `expiresAt`. Threshold: once per `mbTotal` — every
 * settled top-up raises mbTotal, so a stale read (receipt or cache lag) cannot fire the same crossing twice, while
 * the next real crossing (after mbTotal grew) gets a fresh key. (The brief's `floor(remaining / threshold)` bucket
 * would re-block a legitimate later crossing that lands in an already-used bucket.)
 */
export const triggerKey = (key: string, e: Entitlement, reason: 'threshold' | 'expiry'): string =>
  reason === 'expiry' ? `${key}:expiry:${e.expiresAt}` : `${key}:threshold:${e.mbTotal}`;

function facts(
  e: Entitlement,
  p: TopUpPolicy,
  reason: NotificationFacts['reason'],
  boughtMb: number,
  spent: bigint,
  volumeIncrease = boughtMb,
): NotificationFacts {
  return {
    mbRemaining: Math.max(0, e.mbTotal + volumeIncrease - e.mbUsed),
    mbTotal: e.mbTotal + volumeIncrease,
    expiresAt: e.expiresAt,
    boughtMb,
    spentTodayUsd6: usd6ToWire(spent),
    capUsd6: usd6ToWire(p.maxUsd6PerDay),
    reason,
  };
}

export async function tick(deps: AgentDeps, key: string): Promise<TickResult> {
  // concurrency 1 per key, checked synchronously before the first await (AG1.2)
  if (deps.inFlight.has(key)) return { key, verdict: NO_VERDICT, skipped: 'busy' };
  deps.inFlight.add(key);
  try {
    return await run(deps, key);
  } finally {
    deps.inFlight.delete(key);
  }
}

async function run(deps: AgentDeps, key: string): Promise<TickResult> {
  const now = deps.now();
  const ent = sha256Hex(key);
  const skip = async (skipped: string, verdict: TopUpVerdict = NO_VERDICT): Promise<TickResult> => {
    await deps.journal.write({ at: now, ent, event: 'skip', skipped, verdict: verdict.reason });
    logEvent(deps.log, 'info', 'agent.skip', { ent, reason: skipped });
    return { key, verdict, skipped };
  };

  const e = await deps.reads.entitlement(key);
  if (!e) return skip('no-entitlement');
  const pol = await deps.reads.policy(key);
  if (!pol) return skip('no-policy');
  // T-73 b / RT-G-04: whose policy the agent's wallet pays under. Pinned (AGENT_OWNER, required live): that owner only.
  // Unpinned (local only): the policy owner must be the entitlement's payer, so a squatted policy is never followed.
  if (deps.owner !== undefined) {
    if (pol.owner.toLowerCase() !== deps.owner.toLowerCase()) return skip('not-mine');
  } else if (pol.owner.toLowerCase() !== e.payer?.toLowerCase()) {
    return skip('owner-unverified');
  }
  let policy: TopUpPolicy;
  try {
    policy = policyFromWire(pol.policy);
  } catch {
    return skip('invalid-policy');
  }

  // T-30 + AG1.3: the ledger's receipts OR this agent's own record of what it paid today, whichever is higher
  const [ledgerSpent, own] = await Promise.all([
    deps.reads.spentTodayUsd6(key, now),
    deps.state.own(key, now),
  ]);
  // RT-G-03 monotonic guard: a purchase on file from the future means the clock stepped back; "today" is not
  // trustworthy, so nothing is bought until the clock is past it again
  if (own.latestAt !== undefined && now + CLOCK_SKEW_MS < own.latestAt) return skip('clock-behind');
  const ownSpent = own.spentToday;
  const ownExpiry = own.lastExpiryBought;
  const spent = ledgerSpent > ownSpent ? ledgerSpent : ownSpent;
  const plans = await deps.plans.get();
  const stepPrice = priceUsd6(policy.stepMb, STEP_MB, usd6FromWire(plans.paid.priceUsd6PerStep));
  const lastExpiryBought = ownExpiry === e.expiresAt ? ownExpiry : pol.lastExpiryBought;
  const pending = await deps.state.pending(key);
  const verdict: TopUpVerdict = pending
    ? {
        buy: true,
        reason: pending.payment.reason,
        mb: pending.payment.mb,
        costUsd6: BigInt(pending.payment.expectedUsd6),
      }
    : shouldTopUp(e, policy, spent, now, stepPrice, lastExpiryBought);

  await deps.journal.write({
    at: now,
    ent,
    event: 'tick',
    day: dayBucket(now),
    verdict: verdict.reason,
    buy: verdict.buy,
    mbRemaining: e.mbTotal - e.mbUsed,
    spentTodayUsd6: spent,
    capUsd6: policy.maxUsd6PerDay,
  });
  logEvent(deps.log, 'info', 'agent.tick', { ent, verdict: verdict.reason, buy: verdict.buy });

  if (!verdict.buy) {
    if (verdict.reason === 'cap' || verdict.reason === 'paused') {
      const notices = deps.lastNotice ?? new Map<string, string>();
      if (notices.get(key) !== verdict.reason) {
        notices.set(key, verdict.reason);
        const text = await deps.notifier.phrase(facts(e, policy, verdict.reason, 0, spent));
        logEvent(deps.log, 'info', 'agent.skip', {
          ent,
          reason: verdict.reason,
          notification: text,
        });
        return { key, verdict, notification: text };
      }
    } else {
      deps.lastNotice?.delete(key);
    }
    return { key, verdict };
  }

  // A stored legacy policy (stepMb < 1 GB, before the PLAN_MB product unit) asks for a size the API no longer sells:
  // its top-up would be a 400 before any 402. Skip with the reason on the journal; no trigger claimed, nothing signed.
  const sizes = plans.paid.sizesMb;
  if (!pending && sizes !== undefined && !sizes.includes(verdict.mb))
    return skip('step-not-sold', verdict);

  if (deps.dryRun) {
    await deps.journal.write({
      at: now,
      ent,
      event: 'would-buy',
      reason: verdict.reason,
      mb: verdict.mb,
      usd6: verdict.costUsd6,
    });
    return { key, verdict, skipped: 'dry-run' };
  }

  const trigger = pending?.trigger ?? triggerKey(key, e, verdict.reason);
  if (!pending) {
    const claim = await deps.state.claimTrigger(trigger, now);
    if (!claim.ok) return skip(claim.reason, verdict);
  }

  const attempt = async (): Promise<BuyOutcome> => {
    try {
      return await deps.buyer.buy({
        key,
        mb: verdict.mb,
        reason: verdict.reason,
        expectedUsd6: verdict.costUsd6,
        expiresAt: pending?.payment.expiresAt ?? e.expiresAt,
        mbTotalBefore: pending?.payment.mbTotalBefore ?? e.mbTotal,
        ...(pending
          ? { resume: { payload: pending.payment.payload, validBeforeMs: pending.validBefore } }
          : {}),
        onSigned: (validBefore, payload) =>
          deps.state.markSigned(trigger, deps.now(), validBefore, {
            ent,
            mb: verdict.mb,
            reason: verdict.reason,
            expectedUsd6: verdict.costUsd6.toString(),
            expiresAt: e.expiresAt,
            mbTotalBefore: e.mbTotal,
            signedAt: deps.now(),
            payload,
          }),
      });
    } catch (error) {
      // unknown whether anything was signed: keep the claim (it goes stale on its own), report the throw
      await deps.journal.write({ at: now, ent, event: 'error', message: safeError(error) });
      throw error;
    }
  };
  let outcome = await attempt();
  // World ID Agent Pass (docs/WORLD_AGENT_PASS.md): the API refused before any 402 — pause for the human, buy
  // only once the backend accepted the authentication; denied / expired is a skip and the trigger is free again
  if (!outcome.ok && outcome.reason === 'pass-required' && deps.pass !== undefined) {
    const pass = await deps.pass.checkpoint(key).catch(async (error: unknown) => {
      await deps.journal.write({ at: now, ent, event: 'error', message: safeError(error) });
      throw error;
    });
    if (pass !== 'approved') {
      await deps.state.releaseTrigger(trigger);
      return skip(pass, verdict);
    }
    outcome = await attempt();
  }

  if (!outcome.ok) {
    if (!outcome.signed) await deps.state.releaseTrigger(trigger);
    await deps.journal.write({
      at: now,
      ent,
      event: 'skip',
      skipped: outcome.reason,
      signed: outcome.signed,
      trigger: sha256Hex(trigger),
    });
    return { key, verdict, skipped: outcome.reason };
  }

  const recorded = await deps.state.completePurchase(trigger, {
    key,
    now: deps.now(),
    usd6: outcome.usd6,
    ...(verdict.reason === 'expiry'
      ? { expiryFor: pending?.payment.expiresAt ?? e.expiresAt }
      : {}),
  });
  if (!recorded) return skip('already-bought-for-trigger', verdict);
  const hcsSequence = await deps.receipts.submit({
    key,
    network: outcome.network,
    tx: outcome.tx,
    usd6: outcome.usd6,
    mb: outcome.mb,
    reason: verdict.reason,
  });
  // Recovery may start after the ledger already reflects this purchase. Refresh display facts
  // rather than adding the recovered purchase to an already-updated volume/spend snapshot.
  const [current, ownAfter, ledgerAfter] = await Promise.all([
    deps.reads.entitlement(key).catch(() => null),
    deps.state.own(key, deps.now()),
    deps.reads.spentTodayUsd6(key, deps.now()).catch(() => ledgerSpent),
  ]);
  const spentAfter = ledgerAfter > ownAfter.spentToday ? ledgerAfter : ownAfter.spentToday;
  const text = await deps.notifier.phrase(
    facts(current ?? e, policy, verdict.reason, outcome.mb, spentAfter, current ? 0 : outcome.mb),
  );
  await deps.journal.write({
    at: now,
    ent,
    event: 'buy',
    reason: verdict.reason,
    mb: outcome.mb,
    usd6: outcome.usd6,
    network: outcome.network,
    tx: outcome.tx,
    trigger: sha256Hex(trigger),
    ...(hcsSequence === undefined ? {} : { hcsSequence }),
  });
  logEvent(deps.log, 'info', 'agent.buy', {
    ent,
    mb: outcome.mb,
    usd6: outcome.usd6.toString(),
    tx: outcome.tx,
    notification: text,
  });
  deps.lastNotice?.delete(key);
  return {
    key,
    verdict,
    bought: {
      mb: outcome.mb,
      usd6: outcome.usd6,
      tx: outcome.tx,
      network: outcome.network,
      ...(hcsSequence === undefined ? {} : { hcsSequence }),
    },
    notification: text,
  };
}
