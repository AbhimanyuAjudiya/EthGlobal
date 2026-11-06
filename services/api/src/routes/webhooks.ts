/**
 * POST /webhooks/reseller/:provider (brief §4.6; T-34, T-82, A-27). The raw body is read once and verified as bytes;
 * the route alone sets the two pseudo-headers (URL token, socket address) after stripping client copies. eSIM Access
 * webhooks are unsigned, so each event is a HINT: the patched numbers come from reseller.usage(iccid), never the body.
 * Usage is monotonic and ≤ totalMb. 204 / 400 / 401 / 409; never a 500 for bad input.
 */
import { isAdapterError, type EsimUsage } from '@ethglobal/adapters';
import { sha256Hex } from '@ethglobal/crypto';
import { entitlementIndex } from '@ethglobal/octroi';
import type { UsageEvent } from '@ethglobal/protocol/schemas';

import { type AppEnv, type Ctx } from '../context.js';
import { fail } from '../errors.js';
import { campaignReclaimBlocks } from '../flows/campaign-reclaim.js';
import { providerExpiry } from '../flows/lifecycle.js';
import { errName } from '../flows/record.js';

import type { Deps } from '../deps.js';
import type { Hono } from 'hono';

/** The pseudo-headers the route sets (EsimAccessReseller reads them; INTERFACES A-27). */
export const URL_TOKEN_HEADER = 'x-recharge-url-token';
export const REMOTE_IP_HEADER = 'x-recharge-remote-ip';

type Usage = Pick<EsimUsage, 'usedMb' | 'asOf' | 'lifecycle'> & {
  status?: EsimUsage['status'] | undefined;
};

export function registerWebhooks(app: Hono<AppEnv>, deps: Deps): void {
  app.post('/webhooks/reseller/:provider', async (c) => {
    const reseller = deps.adapters.reseller;
    if (c.req.param('provider') !== reseller.name) throw fail('not_found');
    if (deps.health.degraded) throw fail('ledger_unavailable', { detail: 'degraded' });
    const raw = await c.req.raw.text();
    const verdict = reseller.verifyWebhook(raw, pseudoHeaders(c), deps.now());
    deps.metrics.inc('webhook_total', { verdict: verdict.ok ? 'ok' : verdict.reason });
    if (!verdict.ok) {
      c.get('log').warn(
        {
          event: 'webhook',
          provider: reseller.name,
          verdict: verdict.reason,
          ip: c.get('clientIp'),
        },
        'webhook refused',
      );
      throw fail(verdict.reason === 'replay' ? 'replay' : 'unauthorized', {
        reason: verdict.reason,
      });
    }
    let events: UsageEvent[];
    try {
      events = reseller.parseWebhook(raw);
    } catch {
      throw fail('invalid_request', { detail: 'webhook body' });
    }
    for (const event of events) await applyEvent(c, deps, event);
    return c.body(null, 204);
  });
}

/** Request headers minus any client copy of our pseudo-headers, plus the values only the route may set. */
function pseudoHeaders(c: Ctx): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  c.req.raw.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (lower !== URL_TOKEN_HEADER && lower !== REMOTE_IP_HEADER) headers[lower] = value;
  });
  const token = new URL(c.req.url).searchParams.get('token');
  if (token !== null) headers[URL_TOKEN_HEADER] = token;
  headers[REMOTE_IP_HEADER] = c.get('clientIp');
  return headers;
}

async function applyEvent(c: Ctx, deps: Deps, event: UsageEvent): Promise<void> {
  const found = await deps.stores.entitlements.getByIccidHash(sha256Hex(event.iccid));
  if (!found) return; // unknown ICCID: same 204, no oracle
  const e = found.payload;
  let usage: Usage = {
    usedMb: event.usedMb,
    asOf: event.asOf,
    ...(event.status === undefined ? {} : { status: event.status }),
  };
  if (deps.adapters.reseller.name !== 'mock') {
    // unsigned provider (A-27): re-read the authoritative usage, at most once per minute per ICCID
    if (!deps.usagePolls.hit(sha256Hex(event.iccid)).ok) return;
    try {
      usage = await deps.adapters.reseller.usage(event.iccid);
    } catch (error) {
      c.get('log').warn(
        { event: 'webhook', err: isAdapterError(error) ? error.code : errName(error) },
        'usage re-read failed',
      );
      return;
    }
  }
  await patchUsage(deps, e.key, e.mbUsed, e.mbTotal, usage, 'webhook');
}

/** Monotonic, ≤ mbTotal; a decrease is logged and ignored (T-34). Invalidates the /me cache. */
export async function patchUsage(
  deps: Deps,
  key: string,
  _currentMb: number,
  _totalMb: number,
  usage: Usage,
  source: 'webhook' | 'poll',
): Promise<void> {
  await deps.stores.entitlements.patch(
    key,
    (current) => {
      // Re-evaluate on every CAS attempt: a poll can overlap a top-up or a newer usage report.
      if (
        usage.usedMb < current.mbUsed ||
        (current.usageSource !== 'none' && usage.asOf < current.usageAsOf)
      )
        return {};
      const status =
        current.status === 'active' || usage.status === 'active'
          ? 'active'
          : current.status === 'installed' || usage.status === 'installed'
            ? 'installed'
            : undefined;
      return {
        mbUsed: Math.min(usage.usedMb, current.mbTotal),
        usageAsOf: usage.asOf,
        usageSource: source,
        ...(status === undefined ? {} : { status }),
        ...(usage.lifecycle === undefined ? {} : { lifecycle: usage.lifecycle }),
      };
    },
    {
      expiresAt: (current) =>
        !campaignReclaimBlocks(deps, current.key) &&
        usage.usedMb >= current.mbUsed &&
        !deps.refundJobs
          .entries()
          .some(
            ([, job]) =>
              job.kind === 'plan-cancel' &&
              entitlementIndex(job.entitlementKey) === entitlementIndex(current.key),
          ) &&
        (current.usageSource === 'none' || usage.asOf >= current.usageAsOf)
          ? providerExpiry(usage.lifecycle, deps.now())
          : undefined,
    },
  );
  deps.cache.invalidate(key);
}
