/**
 * test/fake-api.ts (agent.md §6) — a Hono fixture that speaks the exact INTERFACES §7 contract for the routes the agent
 * uses (`/plans`, `/me/:key`, `/me/:key/receipts`, `/agent/policy/:key`, `/esim/topup`) with protocol's codec and the
 * octroi stores over a shared InMemoryLedger. Test-only: no business logic beyond "402, then settle, then +mb".
 * Includes a response cache keyed by the submitted authorization, matching the API's paid-request recovery contract.
 */
import { Hono } from 'hono';

import { MockPaymentRail, type InMemoryLedger, type PaymentRail } from '@ethglobal/adapters';
import { sha256Hex } from '@ethglobal/crypto';
import { AgentPolicyStore, buildAccepts, EntitlementStore, ReceiptStore } from '@ethglobal/octroi';
import { dayBucket, keys } from '@ethglobal/protocol/ids';
import {
  isEvmExact,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type SettleResult,
  type AcceptTemplate,
} from '@ethglobal/protocol/schemas';
import { canonicalJson } from '@ethglobal/protocol/typed-data';
import { usd6ToWire } from '@ethglobal/protocol/units';
import {
  decodePaymentPayload,
  encodePaymentRequired,
  encodePaymentResponse,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  paymentRequired,
  PAYMENT_REQUIRED_HEADER,
} from '@ethglobal/protocol/x402';

export type Fault = 'drop-after-settle' | '502' | 'pending' | 'reject' | undefined;

export interface FakeApiOptions {
  ledger: InMemoryLedger;
  now: () => number;
  accepts: AcceptTemplate[];
  priceUsd6PerStep?: bigint;
  /** What /plans advertises (default: the real price); a lying /plans is an attack (AG2). */
  plansPriceUsd6PerStep?: bigint;
  /** /plans `paid.sizesMb` (the API's [1000]); omitted ⇒ an older API that publishes none. */
  sizesMb?: number[];
  rail?: PaymentRail;
  settleHedera?: (payload: PaymentPayload, req: PaymentRequirements) => Promise<SettleResult>;
  /** Hostile 402: rewrite the PaymentRequired (object), or return a raw header string. */
  mutate?: (required: PaymentRequired) => PaymentRequired | string;
  /** The 402 JSON body, when it should differ from the PAYMENT-REQUIRED header. */
  body?: (required: PaymentRequired) => unknown;
  /** Per paid request n (1-based): inject a failure. */
  fault?: (n: number) => Fault;
  /** World ID Agent Pass on: an agent top-up is 403 pass_required until a poll answers `approved`. */
  pass?: { outcomes: ('pending' | 'approved' | 'denied' | 'expired')[] };
}

export interface FakeApi {
  app: Hono;
  fetch: typeof fetch;
  /** Every PAYMENT-SIGNATURE received, decoded. */
  paid: PaymentPayload[];
  /** Successful settlements. */
  settled: SettleResult[];
  /** Raw requests to /esim/topup. */
  topups: { headers: Record<string, string>; url: string }[];
  /** `start` / `poll` calls of the pass routes, in order. */
  passCalls: string[];
  passArmed: boolean;
}

const RESOURCE_DESCRIPTION = '100 MB top-up';

export function createFakeApi(opts: FakeApiOptions): FakeApi {
  const price = opts.priceUsd6PerStep ?? 400_000n;
  const rail = opts.rail ?? new MockPaymentRail({ now: opts.now });
  const entitlements = new EntitlementStore(opts.ledger, opts.now);
  const receipts = new ReceiptStore(opts.ledger, opts.now);
  const policies = new AgentPolicyStore(opts.ledger, opts.now);
  const api: FakeApi = {
    app: new Hono(),
    fetch: undefined as unknown as typeof fetch,
    paid: [],
    settled: [],
    topups: [],
    passCalls: [],
    passArmed: false,
  };
  const app = api.app;
  let paidCount = 0;
  const completed = new Map<string, { body: Record<string, unknown>; settlement: SettleResult }>();

  app.get('/plans', (c) =>
    c.json({
      mode: 'local',
      campaign: null,
      paid: {
        stepMb: 100,
        priceUsd6PerStep: usd6ToWire(opts.plansPriceUsd6PerStep ?? price),
        validityDays: 7,
        accepts: opts.accepts,
        ...(opts.sizesMb === undefined ? {} : { sizesMb: opts.sizesMb }),
      },
      gift: { sizesMb: [100, 300, 1000], claimWindowS: 604_800 },
      simulated: { usage: true, personhood: true },
    }),
  );

  app.get('/me/:key', async (c) => {
    const found = await entitlements.getByKey(c.req.param('key'));
    if (!found) return c.json({ error: 'not_found', message: 'unknown entitlement' }, 404);
    const e = found.payload;
    return c.json({
      entitlementKey: e.key,
      kind: e.kind,
      status: e.status,
      tier: e.tier,
      ...(e.campaignId ? { campaignId: e.campaignId } : {}),
      mbTotal: e.mbTotal,
      mbUsed: e.mbUsed,
      remainingMb: e.mbTotal - e.mbUsed,
      usageAsOf: e.usageAsOf,
      usageSource: e.usageSource,
      expiresAt: e.expiresAt,
      arkivKey: found.entityKey,
      ledgerReadAt: opts.now(),
      cached: false,
      degraded: false,
      ...(e.network ? { network: e.network } : {}),
    });
  });

  app.get('/me/:key/receipts', async (c) => {
    const rows = await receipts.forEntitlement(sha256Hex(c.req.param('key')));
    return c.json({ receipts: rows.map(({ entitlementKeyHash: _h, key: _k, ...r }) => r) });
  });

  app.get('/agent/policy/:key', async (c) => {
    const key = c.req.param('key');
    const found = await policies.get(key);
    if (!found) return c.json({ error: 'not_found', message: 'no policy' }, 404);
    const spent = await receipts.spentUsd6(sha256Hex(key), 'agent-topup', dayBucket(opts.now()));
    return c.json({
      policy: found.payload.policy,
      owner: found.payload.owner,
      spentTodayUsd6: usd6ToWire(spent),
      updatedAt: found.payload.updatedAt,
    });
  });

  app.post('/agent/policy/:key/pass/start', (c) => {
    api.passCalls.push('start');
    return c.json({
      verification_uri: 'https://auth.world.org/device',
      verification_uri_complete: 'https://auth.world.org/device?user_code=ABCD-1234',
      user_code: 'ABCD-1234',
      expires_in: 300,
      interval: 5,
    });
  });
  app.post('/agent/policy/:key/pass/poll', (c) => {
    api.passCalls.push('poll');
    const next = opts.pass?.outcomes.shift() ?? 'pending';
    if (next === 'approved') api.passArmed = true;
    if (next === 'pending') return c.json({ state: 'pending', retryInS: 5 });
    if (next === 'approved')
      return c.json({ state: 'approved', passUntil: opts.now() + 86_400_000 });
    return c.json({ state: next, reason: next === 'denied' ? 'access_denied' : 'expired_token' });
  });

  app.get('/esim/topup', async (c) => {
    api.topups.push({ url: c.req.url, headers: Object.fromEntries(c.req.raw.headers.entries()) });
    const key = c.req.query('key') ?? '';
    const mb = Number(c.req.query('mb'));
    const found = await entitlements.getByKey(key);
    if (!found) return c.json({ error: 'not_found', message: 'unknown entitlement' }, 404);
    // the API's pass guard: refused before any 402 (docs/WORLD_AGENT_PASS.md)
    if (opts.pass && c.req.header('X-Agent-Uaid') !== undefined && !api.passArmed)
      return c.json({ error: 'pass_required', message: 'agent pass required' }, 403);
    const accepts = buildAccepts(
      { accepts: opts.accepts, priceUsd6PerStep: price, stepMb: 100 },
      mb,
    );
    const resource = {
      url: c.req.url,
      description: RESOURCE_DESCRIPTION,
      mimeType: 'application/json',
    };
    const signature = c.req.header(PAYMENT_SIGNATURE_HEADER);
    if (signature === undefined) {
      const required = paymentRequired({
        resource,
        accepts,
        error: 'PAYMENT-SIGNATURE header is required',
      });
      const hostile = opts.mutate?.(required) ?? required;
      const header = typeof hostile === 'string' ? hostile : encodePaymentRequired(hostile);
      c.header(PAYMENT_REQUIRED_HEADER, header);
      return c.json(
        opts.body?.(required) ?? (typeof hostile === 'string' ? required : hostile),
        402,
      );
    }

    const payload = decodePaymentPayload(signature);
    api.paid.push(payload);
    paidCount += 1;
    const identity = canonicalJson({ accepted: payload.accepted, payload: payload.payload });
    const previous = completed.get(identity);
    if (previous) {
      c.header(PAYMENT_RESPONSE_HEADER, encodePaymentResponse(previous.settlement));
      return c.json(previous.body);
    }
    const fault = opts.fault?.(paidCount);
    if (fault === '502')
      return c.json({ error: 'facilitator_unavailable', message: 'upstream' }, 502);
    const req = accepts.find((a) => canonicalJson(a) === canonicalJson(payload.accepted));
    if (!req) return c.json({ error: 'invalid_payment', message: 'accepted entry mismatch' }, 402);
    if (fault === 'pending') {
      const pending: SettleResult = {
        success: false,
        errorReason: 'settlement_pending',
        network: req.network,
        transaction: '0xpending0000',
      };
      c.header(PAYMENT_RESPONSE_HEADER, encodePaymentResponse(pending));
      return c.json({ error: 'provisioning_pending', message: 'settlement pending' }, 202);
    }
    const settlement = isEvmExact(payload.payload)
      ? await rail.settle(payload, req)
      : await (
          opts.settleHedera ??
          (async () => ({
            success: false,
            errorReason: 'unsupported_scheme',
            network: req.network,
          }))
        )(payload, req);
    if (!settlement.success || fault === 'reject') {
      c.header(
        PAYMENT_RESPONSE_HEADER,
        encodePaymentResponse(
          settlement.success
            ? { success: false, errorReason: 'invalid_payment', network: req.network }
            : settlement,
        ),
      );
      return c.json({ error: 'invalid_payment', message: 'settlement failed' }, 402);
    }
    api.settled.push(settlement);
    const after = await entitlements.patch(key, { mbTotal: found.payload.mbTotal + mb });
    const uaid = c.req.header('X-Agent-Uaid');
    await receipts.add({
      v: 1,
      key: keys.receipt(settlement.network, settlement.transaction),
      kind: 'agent-topup',
      entitlementKeyHash: sha256Hex(key),
      mb,
      usd6: req.amount,
      network: settlement.network,
      tx: settlement.transaction,
      payer: settlement.payer,
      ...(uaid ? { uaid } : {}),
      at: opts.now(),
    });
    const expiryBought = c.req.header('X-Agent-Expiry-Bought');
    const pol = await policies.get(key);
    if (expiryBought !== undefined && pol) {
      await policies.put({ ...pol.payload, lastExpiryBought: Number(expiryBought) });
    }
    const body = {
      entitlementKey: key,
      mbTotal: after.payload.mbTotal,
      mbUsed: after.payload.mbUsed,
      expiresAt: after.payload.expiresAt,
      settlement,
      receipt: { arkivKey: after.entityKey },
    };
    completed.set(identity, { body, settlement });
    if (fault === 'drop-after-settle') throw new TypeError('fetch failed: socket hang up');
    c.header(PAYMENT_RESPONSE_HEADER, encodePaymentResponse(settlement));
    return c.json(body);
  });

  app.onError((error) => {
    // a thrown TypeError models a connection dropped after the server did its work
    throw error;
  });

  api.fetch = async (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    app.request(input instanceof URL ? input.toString() : input, init);
  return api;
}
