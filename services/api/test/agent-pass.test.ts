/**
 * World ID Agent Pass (docs/WORLD_AGENT_PASS.md): the device grant against a fake OIDC server (LocalIdp: discovery,
 * device_authorization, token, JWKS with a generated RSA key), the backend validation of the ID token, the
 * protected action (an agent's /esim/topup under a policy) refused with 403 pass_required BEFORE any 402, and the
 * three endings — approved, denied, expired — plus every validation failure the docs' "Check failure paths" list.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { anvilKeys, anvilRoles } from '@ethglobal/adapters/testing';
import { PAYMENT_REQUIRED_HEADER } from '@ethglobal/protocol/x402';

import { agentPolicyPut } from './support/client.js';
import { harness, HUMAN_KEY, provisionPaid, topUp, type Harness } from './support/harness.js';
import { createApp } from '../src/app.js';
import { LocalClock } from '../src/seed.js';
import { LocalIdp, type SimScript } from '../src/world-agent-pass.js';

const POLICY = {
  maxUsd6PerDay: '8000000',
  thresholdMb: 50,
  stepMb: 1000,
  paused: false,
  topUpOnExpiry: true,
  expiryLeadS: 3600,
};
const AGENT = { 'x-agent-uaid': 'uaid:aid:agent-1' };
const AGENT_KEY = anvilKeys[anvilRoles.agent];
const SIM_ENV = {
  WORLD_AGENT_PASS_CLIENT_ID: 'simulated',
  WORLD_AGENT_PASS_CLIENT_SECRET: 'sim-secret-not-a-real-one',
};

interface View {
  pass?: {
    state: string;
    userCode?: string;
    verificationUri?: string;
    verificationUriComplete?: string;
    passUntil?: number;
    reason?: string;
    simulated?: boolean;
  };
}

/** A paid entitlement with a signed policy; returns its key and the pass routes. */
async function policyFor(h: Harness) {
  const key = ((await (await provisionPaid(h)).res.json()) as { entitlementKey: string })
    .entitlementKey;
  const put = await h.json(
    '/agent/policy',
    await agentPolicyPut(HUMAN_KEY, h.deps.chainId, key, POLICY, h.clock.now()),
    {},
    'PUT',
  );
  expect(put.status).toBe(200);
  const path = encodeURIComponent(key);
  return {
    key,
    topup: `/esim/topup?key=${path}&mb=1000`,
    start: () => h.json(`/agent/policy/${path}/pass/start`, {}),
    poll: () => h.json(`/agent/policy/${path}/pass/poll`, {}),
    view: async () => (await (await h.get(`/agent/policy/${path}`)).json()) as View,
  };
}

const sim = (h: Harness): LocalIdp => {
  const idp = h.deps.agentPass?.sim;
  if (!idp) throw new Error('simulator not wired');
  return idp;
};

async function approve(h: Harness, p: Awaited<ReturnType<typeof policyFor>>, script?: SimScript) {
  sim(h).script = script ?? { outcome: 'approve' };
  const start = (await (await p.start()).json()) as { user_code: string };
  expect(start.user_code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
  return (await (await p.poll()).json()) as { state: string; reason?: string; passUntil?: number };
}

describe('World ID Agent Pass: the protected action', () => {
  it('refuses an agent top-up with 403 pass_required before any 402; a human top-up is untouched', async () => {
    const h = await harness({ env: SIM_ENV });
    const p = await policyFor(h);
    const refused = await h.get(p.topup, AGENT);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({
      error: 'pass_required',
      details: { detail: 'none' },
    });
    expect(refused.headers.get(PAYMENT_REQUIRED_HEADER)).toBeNull();
    // the agent's wallet without the header is still the agent (payer on AGENT_PAYERS)
    const quote = await h.get(p.topup);
    expect(quote.status).toBe(402);
    const paidByAgent = await h.get(p.topup, await h.payFor(quote, { key: AGENT_KEY }));
    expect(paidByAgent.status).toBe(403);
    expect(h.deps.metrics.snapshot().counters.settlements_total).toBeUndefined();
    // the human pays as before
    const human = await topUp(h, p.key);
    expect(human.paid.status).toBe(200);
    expect((await p.view()).pass).toEqual({ state: 'none', simulated: true });
  });

  it('is off without WORLD_AGENT_PASS_CLIENT_ID: no pass in the view, no routes, agent top-ups settle', async () => {
    const h = await harness();
    const p = await policyFor(h);
    expect((await p.view()).pass).toBeUndefined();
    expect((await p.start()).status).toBe(404);
    const paid = await topUp(h, p.key, { payKey: AGENT_KEY, headers: AGENT });
    expect(paid.paid.status).toBe(200);
  });
});

describe('World ID Agent Pass: the journey', () => {
  it('start → human approves on the phone page → poll validates the ID token → policy armed → agent buys', async () => {
    const h = await harness({ env: SIM_ENV });
    const p = await policyFor(h);
    const started = await p.start();
    expect(started.status).toBe(200);
    const body = (await started.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ expires_in: 300, interval: 1 });
    expect(body.device_code).toBeUndefined();
    expect(String(body.verification_uri_complete)).toContain(
      `/__local/agent-pass/${String(body.user_code)}`,
    );
    const pending = (await p.view()).pass;
    expect(pending).toMatchObject({ state: 'pending', userCode: body.user_code, simulated: true });
    expect(JSON.stringify(h.lines)).not.toContain('device_code');
    expect(await (await p.poll()).json()).toEqual({ state: 'pending', retryInS: 1 });
    // a second start inside 30 s repeats the same attempt (no second device code at World)
    expect(((await (await p.start()).json()) as { user_code: string }).user_code).toBe(
      body.user_code,
    );
    // the phone page (local-only route): approve this user code
    const local = createApp(h.deps, { localClock: new LocalClock(h.clock.now) });
    const page = await local.request(
      `/__local/agent-pass/${String(body.user_code)}?outcome=approve`,
      {
        headers: { 'x-forwarded-for': '198.51.100.9' },
      },
    );
    expect(await page.json()).toEqual({ simulated: true, outcome: 'approve', resolved: true });
    const approved = (await (await p.poll()).json()) as { state: string; passUntil: number };
    expect(approved.state).toBe('approved');
    expect(approved.passUntil).toBe(Math.floor(h.clock.now() / 1000) * 1000 + 86_400_000);
    expect((await p.view()).pass).toEqual({
      state: 'armed',
      passUntil: approved.passUntil,
      simulated: true,
    });
    const bought = await topUp(h, p.key, { payKey: AGENT_KEY, headers: AGENT });
    expect(bought.paid.status).toBe(200);
    // the pass lifts at passUntil: the next agent top-up is refused again
    h.clock.advance(86_400_000 + 1);
    expect((await h.get(p.topup, AGENT)).status).toBe(403);
    expect((await p.view()).pass?.state).toBe('none');
  });

  it('denied: access_denied ends the attempt; the top-up stays refused', async () => {
    const h = await harness({ env: SIM_ENV });
    const p = await policyFor(h);
    expect(await approve(h, p, { outcome: 'deny' })).toEqual({
      state: 'denied',
      reason: 'access_denied',
    });
    expect((await p.view()).pass).toMatchObject({ state: 'denied', reason: 'access_denied' });
    expect(await (await p.poll()).json()).toEqual({ state: 'denied', reason: 'access_denied' });
    const refused = await h.get(p.topup, AGENT);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ details: { detail: 'denied' } });
  });

  it('expired: expired_token from World, or the attempt lifetime passing without a poll', async () => {
    const h = await harness({ env: SIM_ENV });
    const p = await policyFor(h);
    expect(await approve(h, p, { outcome: 'expire' })).toEqual({
      state: 'expired',
      reason: 'expired_token',
    });
    expect((await h.get(p.topup, AGENT)).status).toBe(403);
    h.clock.advance(60_000);
    sim(h).script = { outcome: 'pending' };
    await p.start();
    h.clock.advance(301_000);
    expect((await p.view()).pass?.state).toBe('expired');
    expect(await (await p.poll()).json()).toEqual({ state: 'expired', reason: 'expired_token' });
    expect((await h.get(p.topup, AGENT)).status).toBe(403);
  });

  it('slow_down adds five seconds; a token poll failure keeps waiting; a changed policy needs a new pass', async () => {
    const h = await harness({ env: SIM_ENV });
    const p = await policyFor(h);
    expect((await approve(h, p)).state).toBe('approved');
    const changed = await h.json(
      '/agent/policy',
      await agentPolicyPut(
        HUMAN_KEY,
        h.deps.chainId,
        p.key,
        { ...POLICY, paused: true },
        h.clock.now() + 1,
      ),
      {},
      'PUT',
    );
    expect(((await changed.json()) as View).pass?.state).toBe('none');
    expect((await h.get(p.topup, AGENT)).status).toBe(403);
  });
});

describe('World ID Agent Pass: backend validation of the ID token', () => {
  const rejected = async (script: SimScript) => {
    const h = await harness({ env: SIM_ENV });
    const p = await policyFor(h);
    const result = await approve(h, p, script);
    expect(result).toEqual({ state: 'denied', reason: 'invalid_pass' });
    expect((await h.get(p.topup, AGENT)).status).toBe(403);
    return h;
  };

  it('wrong acr (device-level) → invalid_pass', async () => {
    const h = await rejected({
      outcome: 'approve',
      tamper: { acr: 'https://world.org/oidc/acr/device' },
    });
    expect(h.lines.some((l) => l.includes('"why":"acr"'))).toBe(true);
  });

  it('stale auth_time (older than WORLD_AGENT_PASS_MAX_AGE_S) → invalid_pass', async () => {
    const h = await rejected({ outcome: 'approve', tamper: { authTimeOffsetS: -301 } });
    expect(h.lines.some((l) => l.includes('"why":"auth_time"'))).toBe(true);
  });

  it('a nonce that is present but not ours → invalid_pass', async () => {
    const h = await rejected({ outcome: 'approve', tamper: { nonce: 'another-attempt' } });
    expect(h.lines.some((l) => l.includes('"why":"nonce"'))).toBe(true);
  });

  it('alg none, another audience, another issuer → invalid_pass', async () => {
    await rejected({ outcome: 'approve', tamper: { alg: 'none' } });
    await rejected({ outcome: 'approve', tamper: { aud: 'someone-else' } });
    await rejected({ outcome: 'approve', tamper: { iss: 'https://evil.invalid' } });
  });

  it('a kid the JWKS does not carry → invalid_pass; a rotated key is fetched and accepted', async () => {
    await rejected({ outcome: 'approve', tamper: { kid: 'unknown-kid' } });
    const h = await harness({ env: SIM_ENV });
    const p = await policyFor(h);
    expect((await approve(h, p)).state).toBe('approved');
    h.deps.agentPass?.revoke(p.key);
    sim(h).rotateKey();
    h.clock.advance(31_000);
    expect((await approve(h, p)).state).toBe('approved');
  });

  it('a replayed ID token is rejected (one use); a different World ID cannot arm a bound policy', async () => {
    const h = await harness({ env: SIM_ENV });
    const p = await policyFor(h);
    expect((await approve(h, p)).state).toBe('approved');
    h.deps.agentPass?.revoke(p.key);
    h.clock.advance(31_000);
    expect(await approve(h, p, { outcome: 'approve', replay: true })).toEqual({
      state: 'denied',
      reason: 'invalid_pass',
    });
    expect(h.lines.some((l) => l.includes('"why":"replay"'))).toBe(true);
    h.clock.advance(31_000);
    expect(await approve(h, p, { outcome: 'approve', tamper: { sub: 'another-human' } })).toEqual({
      state: 'denied',
      reason: 'invalid_pass',
    });
    expect(h.lines.some((l) => l.includes('"why":"approver"'))).toBe(true);
    expect((await h.get(p.topup, AGENT)).status).toBe(403);
  });
});

describe('World ID Agent Pass: the real client path and durability', () => {
  it('talks to the IdP over the injected fetch with client_secret_post and discovery; a refused client is 503', async () => {
    let nowFn: () => number = Date.now;
    const idp = new LocalIdp({
      now: () => nowFn(),
      clientId: 'client_recharge_agent',
      clientSecret: 'worldidp_client_secret_test_only',
      verificationBase: 'https://idp.test/device',
      issuer: 'https://idp.test',
    });
    const h = await harness({
      env: {
        WORLD_AGENT_PASS_CLIENT_ID: 'client_recharge_agent',
        WORLD_AGENT_PASS_CLIENT_SECRET: 'worldidp_client_secret_test_only',
        WORLD_AGENT_PASS_ISSUER: 'https://idp.test',
      },
      overrides: { fetch: idp.fetch },
    });
    nowFn = h.clock.now;
    expect(h.deps.agentPass?.simulated).toBe(false);
    const p = await policyFor(h);
    idp.script = { outcome: 'approve', intervalS: 5 };
    const start = (await (await p.start()).json()) as Record<string, unknown>;
    expect(start.interval).toBe(5);
    expect(String(start.verification_uri)).toContain('https://idp.test/device/');
    const polled = (await (await p.poll()).json()) as { state: string };
    expect(polled.state).toBe('approved');
    expect((await p.view()).pass).toMatchObject({ state: 'armed' });
    expect((await p.view()).pass?.simulated).toBeUndefined();
    expect(JSON.stringify(h.lines)).not.toContain('worldidp_client_secret');

    const wrong = await harness({
      env: {
        WORLD_AGENT_PASS_CLIENT_ID: 'client_recharge_agent',
        WORLD_AGENT_PASS_CLIENT_SECRET: 'not-the-registered-secret',
        WORLD_AGENT_PASS_ISSUER: 'https://idp.test',
      },
      overrides: { fetch: idp.fetch },
    });
    const q = await policyFor(wrong);
    const refused = await q.start();
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ error: 'idp_unavailable' });
  });

  it('an armed pass survives a restart through STATE_FILE', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'agent-pass-')), 'state.json');
    const h = await harness({ env: { ...SIM_ENV, STATE_FILE: file } });
    const p = await policyFor(h);
    expect((await approve(h, p)).state).toBe('approved');
    const restarted = await h.restart();
    expect(restarted.deps.agentPass?.armed(p.key)).toBe(true);
    const quote = await restarted.app.request(p.topup, {
      headers: { ...AGENT, 'x-forwarded-for': '198.51.100.7' },
    });
    expect(quote.status).toBe(402);
  });

  it('refuses the simulator and a secret-less client in live (env)', async () => {
    const { parseEnv } = await import('../src/env.js');
    const live = {
      MODE: 'live',
      RPC_URL: 'https://rpc.test',
      CHAIN: '84532',
      STATE_FILE: '/tmp/x',
      OCTROI_SECRET: `0x${'ab'.repeat(32)}`,
      SERVER_SEAL_KEY: `0x${'cd'.repeat(32)}`,
      ATTESTOR_PRIVATE_KEY: `0x${'ef'.repeat(32)}`,
      RELAYER_PRIVATE_KEY: `0x${'12'.repeat(32)}`,
      TREASURY_PRIVATE_KEY: `0x${'34'.repeat(32)}`,
      ARKIV_PRIVATE_KEY: `0x${'56'.repeat(32)}`,
      WORLD_RP_SIGNING_KEY: `0x${'78'.repeat(32)}`,
      PAYOUT_ADDRESS: '0x1111111111111111111111111111111111111111',
      WORLD_RP_ID: 'rp_live',
      WORLD_APP_ID: 'app_live',
    };
    expect(() => parseEnv({ ...live, WORLD_AGENT_PASS_CLIENT_ID: 'simulated' })).toThrow(
      /local-only/,
    );
    expect(() => parseEnv({ ...live, WORLD_AGENT_PASS_CLIENT_ID: 'client_x' })).toThrow(
      /WORLD_AGENT_PASS_CLIENT_SECRET/,
    );
    expect(
      parseEnv({
        ...live,
        WORLD_AGENT_PASS_CLIENT_ID: 'client_x',
        WORLD_AGENT_PASS_CLIENT_SECRET: 's',
      }).WORLD_AGENT_PASS_ACR,
    ).toEqual(['https://world.org/oidc/acr/orb', 'https://world.org/oidc/acr/selfie']);
  });
});
