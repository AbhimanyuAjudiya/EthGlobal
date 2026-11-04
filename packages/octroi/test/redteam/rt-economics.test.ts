/**
 * Red team (wave 1, octroi): economic invariants under adversarial interleavings (T-18, T-24, T-25, T-46).
 * A small model of the API saga (decide → DataDrop.claim → EntitlementStore.create) and of DataDrop's
 * counters is driven by fast-check. `_RTFINDING` tests (marked `// RT-FINDING`) fail today.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { InMemoryLedger, MockPersonhood, type Personhood } from '@ethglobal/adapters';
import { fakeClock, fixtureProof, T0 } from '@ethglobal/adapters/testing';
import { hourBucket, type Hex } from '@ethglobal/protocol/ids';

import {
  challenge,
  decide,
  EntitlementStore,
  type Campaign,
  type CampaignCounters,
  type Decision,
} from '../../src/index.js';
import {
  campaign,
  counters,
  deps,
  freeReq,
  NULLIFIER,
  SECRET,
  SPK,
  type TestDeps,
} from '../helpers.js';
import { networked } from './rt-helpers.js';

const HOUR = 3_600_000;
const CAMPAIGN_B: Hex = `0x${'bc'.repeat(32)}`;

/** A verifier whose level can change between calls (tier downgrade / upgrade), signal-checked like the mock. */
const switchable = (
  state: { level: 'orb' | 'document' | 'device' },
  nullifierHash: Hex = NULLIFIER,
): Personhood => ({
  verify: async () => ({ nullifierHash, level: state.level }),
});

/** DataDrop model: per-campaign counters and the claimed set (on-chain is authoritative, T-18). */
class Chain {
  readonly state = new Map<string, CampaignCounters & { claims: Set<string> }>();
  constructor(private readonly now: () => number) {}
  open(c: Campaign, budgetUsd6: bigint) {
    this.state.set(c.id, {
      ...counters({ budgetUsd6, hourBucket: hourBucket(this.now()) }),
      claims: new Set(),
    });
  }
  read(c: Campaign): CampaignCounters {
    const s = this.state.get(c.id)!;
    const { claims: _claims, ...rest } = s;
    return { ...rest };
  }
  claim(
    c: Campaign,
    claimKey: Hex,
  ): 'ok' | 'AlreadyClaimed' | 'HourlyCap' | 'BudgetExhausted' | 'Paused' {
    const s = this.state.get(c.id)!;
    if (s.paused) return 'Paused';
    if (s.claims.has(claimKey)) return 'AlreadyClaimed';
    const bucket = hourBucket(this.now());
    if (bucket > s.hourBucket) {
      s.hourBucket = bucket;
      s.claimsThisHour = 0;
    }
    if (s.claimsThisHour >= c.claimsPerHour) return 'HourlyCap';
    if (s.spentUsd6 + c.pricePerClaimUsd6 > s.budgetUsd6) return 'BudgetExhausted';
    s.claims.add(claimKey);
    s.claimsThisHour += 1;
    s.spentUsd6 += c.pricePerClaimUsd6;
    return 'ok';
  }
}

describe('attack: rt same nullifier, two campaigns, concurrently (T-18 × T-25)', () => {
  // RT-FINDING RT-O-03
  it('two concurrent claims by one human on campaigns A and B: never two live free entitlements and never a paid claim without an entitlement_RTFINDING', async () => {
    const clock = fakeClock();
    const base = new InMemoryLedger({ now: clock.now });
    const d: TestDeps = {
      ...deps({}, clock),
      ledger: networked(base),
      personhood: switchable({ level: 'orb' }),
    };
    const chain = new Chain(clock.now);
    const A = campaign();
    const B = campaign({ id: CAMPAIGN_B });
    chain.open(A, 10_000_000n);
    chain.open(B, 10_000_000n);
    const store = new EntitlementStore(d.ledger, d.now);
    const saga = async (c: Campaign) => {
      const ch = challenge('recharge', '/claim', SPK, clock.now(), SECRET);
      const r = await decide(
        freeReq(d, { challenge: ch, campaign: c, counters: chain.read(c) }),
        d,
      );
      if (r.kind !== 'serve-free') return { r, chain: 'skipped', created: false };
      const onchain = chain.claim(c, r.claimKey);
      if (onchain !== 'ok') return { r, chain: onchain, created: false };
      try {
        await store.create(r.entitlement);
        return { r, chain: onchain, created: true };
      } catch {
        return { r, chain: onchain, created: false };
      }
    };
    const out = await Promise.all([saga(A), saga(B)]);
    const sponsorPaidForNothing = out.filter((o) => o.chain === 'ok' && !o.created).length;
    const live = await base.query({ annotations: { type: 'entitlement' } });
    expect(sponsorPaidForNothing).toBe(0);
    expect(live.length).toBeLessThanOrEqual(1);
  });

  // Property: sequentially the global free key makes a second campaign a replay (one live free bundle per human).
  it('sequential A then B → B is deny:replay while A is live', async () => {
    const d = { ...deps(), personhood: switchable({ level: 'orb' }) };
    const first = await decide(freeReq(d), d);
    expect(first.kind).toBe('serve-free');
    await new EntitlementStore(d.ledger, d.now).create(
      (first as Extract<Decision, { kind: 'serve-free' }>).entitlement,
    );
    const second = await decide(freeReq(d, { campaign: campaign({ id: CAMPAIGN_B }) }), d);
    expect(second).toMatchObject({ kind: 'deny', reason: 'replay' });
  });

  // Property: same campaign, concurrent: both may pass decide, but the claim key is identical, so the chain
  // admits exactly one (on-chain authority, T-18).
  it('same campaign, concurrent, permissive verifier → both decide serve-free with ONE claimKey; chain admits one', async () => {
    const clock = fakeClock();
    const d: TestDeps = { ...deps({}, clock), personhood: switchable({ level: 'orb' }) };
    const chain = new Chain(clock.now);
    chain.open(campaign(), 10_000_000n);
    const rs = await Promise.all([decide(freeReq(d), d), decide(freeReq(d), d)]);
    const keys = rs.flatMap((r) => (r.kind === 'serve-free' ? [r.claimKey] : []));
    expect(new Set(keys).size).toBe(1);
    expect(keys.map((k) => chain.claim(campaign(), k)).filter((x) => x === 'ok')).toHaveLength(1);
  });
});

describe('attack: rt state changes between challenge issue and consume', () => {
  // Property: a tier change between challenge and claim is decided by the verifier at claim time only, and a
  // challenge spent on the device answer is not reusable after an "upgrade".
  it('device at claim → payment-required (challenge consumed); same challenge after upgrade → replay; fresh one → serve-free', async () => {
    const state = { level: 'device' as 'orb' | 'device' };
    const d = { ...deps(), personhood: switchable(state) };
    const ch = challenge('recharge', '/claim', SPK, d.now(), SECRET);
    expect((await decide(freeReq(d, { challenge: ch }), d)).kind).toBe('payment-required');
    state.level = 'orb';
    expect(await decide(freeReq(d, { challenge: ch }), d)).toMatchObject({
      kind: 'deny',
      reason: 'replay',
    });
    expect((await decide(freeReq(d), d)).kind).toBe('serve-free');
  });

  // Property: a campaign that expires between challenge issue and consume is refused before the challenge is
  // consumed (paused-then-unpaused with the same challenge is O7's 'a doomed claim does not consume the challenge').
  it('campaign expiring between issue and consume → expired', async () => {
    const d2 = deps();
    const ch2 = challenge('recharge', '/claim', SPK, d2.now(), SECRET);
    d2.clock.advance(60_000);
    const r = await decide(
      freeReq(d2, { challenge: ch2, campaign: campaign({ expiresAt: d2.now() }) }),
      d2,
    );
    expect(r).toMatchObject({ reason: 'expired' });
  });

  // Property: hour-bucket boundary — the last ms of an hour is still capped, the first ms of the next is not;
  // a chain bucket AHEAD of the server clock is honoured (never treated as stale).
  it('hour-bucket boundary off-by-one', async () => {
    const H = hourBucket(T0);
    const atEnd = fakeClock((H + 1) * HOUR - 1);
    const d1 = deps({}, atEnd);
    const full = counters({ claimsThisHour: 5, hourBucket: H });
    expect(
      await decide(
        freeReq(d1, { counters: full, campaign: campaign({ expiresAt: T0 + 9 * HOUR }) }),
        d1,
      ),
    ).toMatchObject({ reason: 'cap' });
    const atStart = fakeClock((H + 1) * HOUR);
    const d2 = deps({}, atStart);
    expect(
      (
        await decide(
          freeReq(d2, { counters: full, campaign: campaign({ expiresAt: T0 + 9 * HOUR }) }),
          d2,
        )
      ).kind,
    ).toBe('serve-free');
    const d3 = deps({}, fakeClock(T0));
    expect(
      await decide(
        freeReq(d3, { counters: counters({ claimsThisHour: 5, hourBucket: H + 1 }) }),
        d3,
      ),
    ).toMatchObject({ reason: 'cap' });
  });

  // Property: budget boundary in micro-USD — exactly reaching the budget is allowed, one micro-USD short is not.
  it('budget boundary', async () => {
    const d = deps();
    expect(
      (
        await decide(
          freeReq(d, { counters: counters({ budgetUsd6: 1_000_000n, spentUsd6: 500_000n }) }),
          d,
        )
      ).kind,
    ).toBe('serve-free');
    const d2 = deps();
    expect(
      await decide(
        freeReq(d2, { counters: counters({ budgetUsd6: 999_999n, spentUsd6: 500_000n }) }),
        d2,
      ),
    ).toMatchObject({ reason: 'budget' });
  });

  // RT-FINDING RT-O-08
  it('after the free entitlement expires, a second claim on the SAME campaign is refused inside decide()_RTFINDING', async () => {
    const clock = fakeClock();
    const d: TestDeps = { ...deps({}, clock), personhood: switchable({ level: 'orb' }) };
    const chain = new Chain(clock.now);
    const c = campaign({ validityDays: 1, expiresAt: T0 + 30 * 86_400_000 });
    chain.open(c, 10_000_000n);
    const first = await decide(freeReq(d, { campaign: c, counters: chain.read(c) }), d);
    if (first.kind !== 'serve-free') throw new Error('setup');
    chain.claim(c, first.claimKey);
    await new EntitlementStore(d.ledger, d.now).create(first.entitlement);
    clock.advance(2 * 86_400_000); // entitlement gone; campaign still live
    // The caller reads counters BEFORE decide(): it cannot compute onchainClaimKey (needs the nullifier from
    // verify), so `claimed` is unknown. decide() has no hook to ask DataDrop.claimed(id, claimKey) itself.
    const second = await decide(freeReq(d, { campaign: c, counters: chain.read(c) }), d);
    expect(second).toMatchObject({ kind: 'deny', reason: 'replay' });
  });
});

describe('attack: rt model-based free lane (fast-check)', () => {
  const action = fc.record({
    campaign: fc.constantFrom(0, 1),
    person: fc.nat({ max: 5 }),
    level: fc.constantFrom('orb' as const, 'document' as const, 'device' as const),
    pause: fc.boolean(),
    advanceMs: fc.oneof(
      fc.constant(0),
      fc.integer({ min: 1, max: 40 * 60_000 }),
      fc.constant(HOUR),
    ),
    reuseChallenge: fc.boolean(),
  });

  // Property: over any sequence of claims across two campaigns, with pauses, tier switches, hour crossings and
  // challenge reuse — Σ spent ≤ budget per campaign, ≤ 1 on-chain claim per (campaign, human), ≤ 1 live free
  // entitlement per human, device never served free, and nothing served while paused / capped / exhausted.
  it('sequential saga invariants hold for 200 random runs', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(action, { minLength: 1, maxLength: 40 }), async (steps) => {
        const clock = fakeClock();
        const d: TestDeps = {
          ...deps({}, clock),
          personhood: { verify: (...a) => new MockPersonhood({ expectSignal: true }).verify(...a) },
        };
        const chain = new Chain(clock.now);
        const cs = [
          campaign({ claimsPerHour: 2, expiresAt: T0 + 30 * 86_400_000 }),
          campaign({
            id: CAMPAIGN_B,
            claimsPerHour: 3,
            pricePerClaimUsd6: 700_000n,
            expiresAt: T0 + 30 * 86_400_000,
          }),
        ];
        chain.open(cs[0]!, 2_000_000n);
        chain.open(cs[1]!, 2_100_000n);
        const store = new EntitlementStore(d.ledger, d.now);
        let last = challenge('recharge', '/claim', SPK, clock.now(), SECRET);
        for (const s of steps) {
          clock.advance(s.advanceMs);
          const c = cs[s.campaign]!;
          if (s.pause) chain.state.get(c.id)!.paused = !chain.state.get(c.id)!.paused;
          const ch = s.reuseChallenge
            ? last
            : challenge('recharge', '/claim', SPK, clock.now(), SECRET);
          last = ch;
          const ct = chain.read(c);
          const r = await decide(
            {
              ...freeReq(d, { challenge: ch, campaign: c, counters: ct }),
              proof: fixtureProof(s.level, ch.signal, `p${s.person}`),
            },
            d,
          );
          if (r.kind !== 'serve-free') continue;
          expect(s.level).not.toBe('device');
          expect(ct.paused).toBe(false);
          const res = chain.claim(c, r.claimKey);
          if (res === 'ok') await store.create(r.entitlement);
        }
        for (const [i, c] of cs.entries()) {
          const st = chain.state.get(c.id)!;
          expect(st.spentUsd6).toBeLessThanOrEqual(st.budgetUsd6);
          expect(st.claims.size * Number(c.pricePerClaimUsd6)).toBe(Number(st.spentUsd6));
          void i;
        }
        const live = await d.ledger.query({ annotations: { type: 'entitlement' } });
        expect(new Set(live.map((e) => e.annotations.key)).size).toBe(live.length);
      }),
      { numRuns: 200 },
    );
  });
});
