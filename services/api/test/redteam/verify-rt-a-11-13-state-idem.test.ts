/**
 * Red-team verification variants:
 *   RT-A-11 — the durable state (STATE_FILE, sealed, 0600): a T-24 intent (not only a pending delivery) survives a
 *             restart and completes on the new process without re-proving; the file at rest carries no capability in
 *             clear; a truncated file or one sealed to another key makes boot fail closed (never an empty state).
 *   RT-A-13 — nine concurrent redeems with one Idempotency-Key and six different bodies plus repeats of one body
 *             from one client ⇒ exactly one processed.
 */
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { generateSessionKeypair, bytesToHex } from '@ethglobal/crypto';

import { harness, seedCard, type Harness } from '../support/harness.js';

const stateFile = () => join(mkdtempSync(join(tmpdir(), 'verify-a11-')), 'api.state');

describe('verify RT-A-11: durable state across restarts', () => {
  it('a T-24 intent survives a restart and completes on the new process with the first proof', async () => {
    const STATE_FILE = stateFile();
    const h = await harness({ env: { STATE_FILE } });
    const keys = generateSessionKeypair();
    h.dataDrop.failNext.claim = true;
    const first = await h.claim({ seed: 'verify-a11-intent', keys });
    expect(first.res.status).toBe(503);
    const restarted = await h.restart();
    const spk = bytesToHex(keys.publicKey);
    expect(restarted.deps.intents.get(spk.toLowerCase())).toBeDefined();
    const ip = { 'x-forwarded-for': '203.0.113.150', 'content-type': 'application/json' };
    const ch = await (
      await restarted.app.request('/challenge', {
        method: 'POST',
        headers: ip,
        body: JSON.stringify({ audience: 'recharge', path: '/claim', sessionPubKey: spk }),
      })
    ).json();
    const retry = await restarted.app.request('/claim', {
      method: 'POST',
      headers: ip,
      body: JSON.stringify({
        proof: first.proof,
        campaignId: h.campaignId,
        challenge: ch,
        sessionPubKey: spk,
      }),
    });
    expect(retry.status).toBe(201);
    const { entitlementKey } = (await retry.json()) as { entitlementKey: string };
    // at rest: sealed, owner-only, no capability in clear
    const raw = readFileSync(STATE_FILE, 'utf8');
    expect(raw).not.toContain(entitlementKey);
    expect(raw).not.toContain('ent:v1:');
    expect(statSync(STATE_FILE).mode & 0o077).toBe(0);
  });

  it.each([
    ['truncated', (s: string) => s.slice(0, Math.floor(s.length / 2))],
    [
      'sealed box with a flipped ciphertext byte',
      (s: string) => s.replace(/"([A-Za-z0-9+/]{8})/, '"AAAAAAAA'),
    ],
    ['empty JSON object', () => '{}'],
  ])('a %s state file ⇒ boot refuses (fail closed), never an empty state', async (_n, damage) => {
    const STATE_FILE = stateFile();
    const h: Harness = await harness({ env: { STATE_FILE } });
    h.dataDrop.failNext.claim = true;
    expect((await h.claim({ seed: 'verify-a11-damage' })).res.status).toBe(503); // writes an intent
    writeFileSync(STATE_FILE, damage(readFileSync(STATE_FILE, 'utf8')));
    await expect(h.restart()).rejects.toThrow(/STATE_FILE/);
  });
});

describe('verify RT-A-13: one Idempotency-Key, many bodies, one client', () => {
  it('6 different PINs + 3 repeats of one, concurrently, one key (under the 10/min limit) ⇒ exactly one 201', async () => {
    const h = await harness();
    const cards = await Promise.all(Array.from({ length: 6 }, () => seedCard(h, 300)));
    const ip = '203.0.113.160';
    const spk = `0x${'ef'.repeat(32)}` as const;
    const send = async (pin: string) => {
      const challenge = await h.challengeFor('/card/redeem', spk);
      return h.request('/card/redeem', {
        method: 'POST',
        ip,
        headers: { 'content-type': 'application/json', 'idempotency-key': 'verify-a13' },
        body: JSON.stringify({ pin, challenge, sessionPubKey: spk }),
      });
    };
    const pins = [...cards.map((c) => c.pin), ...Array<string>(3).fill(cards[0]!.pin)];
    const rs = await Promise.all(pins.map(send));
    const created = rs.filter((r) => r.status === 201).length;
    expect(created).toBe(1);
    for (const r of rs) expect([201, 409]).toContain(r.status);
  });
});
