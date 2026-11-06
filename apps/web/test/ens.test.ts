import { decodeFunctionData, parseAbi, toHex } from 'viem';
import { packetToBytes } from 'viem/ens';
import { describe, expect, it } from 'vitest';

import { brandingCall, checkCampaignName, xHandle } from '../lib/ens';

const POOL = 'eip155:296:0x2d4d52989545FF0d0CD91D77A33f14063f57c9E6';
const ID = `0x${'c0'.repeat(32)}`;
const NOW = 1_800_000_000_000;
const facts = (texts: Record<string, string>, expiry = BigInt(NOW / 1000 + 86_400)) => ({
  name: 'goa-beach.re-charge.eth',
  texts,
  expiry,
});
const ours = { 'recharge.campaign': ID, 'recharge.pool': POOL, 'recharge.bundle': '1 GB · 7 days' };

describe('checkCampaignName (/c/<slug>)', () => {
  it('a live name pointing at our DataDrop is a campaign (pool compared case-insensitively)', () => {
    const out = checkCampaignName(
      facts({ ...ours, 'recharge.pool': POOL.toLowerCase(), 'com.twitter': '@GoaBeach' }),
      NOW,
      POOL,
    );
    expect(out).toMatchObject({
      ok: true,
      campaignId: ID,
      bundle: '1 GB · 7 days',
      twitter: 'GoaBeach',
    });
  });

  it('a name pointing at another pool (a look-alike) is refused', () => {
    expect(
      checkCampaignName(
        facts({
          ...ours,
          'recharge.pool': 'eip155:296:0x000000000000000000000000000000000000dEaD',
        }),
        NOW,
        POOL,
      ),
    ).toMatchObject({ ok: false, reason: 'foreign' });
    expect(checkCampaignName(facts({ ...ours, 'recharge.pool': '' }), NOW, POOL)).toMatchObject({
      ok: false,
    });
    // our own pool unknown to this build (no NEXT_PUBLIC_DATADROP_ADDRESS): nothing is ours
    expect(checkCampaignName(facts(ours), NOW, 'eip155:296:')).toMatchObject({
      ok: false,
      reason: 'foreign',
    });
  });

  it('expired → ended; never registered → unknown; junk campaign id → foreign', () => {
    expect(checkCampaignName(facts(ours, BigInt(NOW / 1000)), NOW, POOL)).toMatchObject({
      ok: false,
      reason: 'expired',
    });
    expect(checkCampaignName(facts({}, 0n), NOW, POOL)).toMatchObject({ reason: 'unknown' });
    expect(
      checkCampaignName(facts({ ...ours, 'recharge.campaign': '0x12' }), NOW, POOL),
    ).toMatchObject({ reason: 'foreign' });
  });

  it('a sponsor handle that is not a handle is dropped; descriptions are clamped', () => {
    const out = checkCampaignName(
      facts({ ...ours, 'com.twitter': 'javascript:alert(1)', description: 'x'.repeat(400) }),
      NOW,
      POOL,
    );
    expect(out).not.toHaveProperty('twitter');
    expect(out.ok && out.description).toHaveLength(280);
  });
});

describe('xHandle and brandingCall (Edit branding)', () => {
  it('normalises X handles', () => {
    expect(xHandle('@acme_1')).toBe('acme_1');
    expect(xHandle('https://x.com/acme/status/1')).toBe('acme');
    expect(xHandle('twitter.com/acme')).toBe('acme');
    expect(xHandle('not a handle')).toBeUndefined();
  });

  it('one change is a plain setText; several go in one multicall to the same resolver', () => {
    const abi = parseAbi([
      'function setText(bytes name, string key, string value)',
      'function multicall(bytes[] calls) returns (bytes[] results)',
    ]);
    const resolver = '0xe1ea7EC45d82cB79E8DfD959F4aBFe1212e64C1f';
    const node = toHex(packetToBytes('goa-beach.re-charge.eth'));
    const one = brandingCall(resolver, 'goa-beach.re-charge.eth', [
      ['avatar', 'https://a.b/c.png'],
    ]);
    expect(one.to).toBe(resolver);
    expect(decodeFunctionData({ abi, data: one.data }).args).toEqual([
      node,
      'avatar',
      'https://a.b/c.png',
    ]);
    const many = brandingCall(resolver, 'goa-beach.re-charge.eth', [
      ['description', 'Free data at the beach'],
      ['com.twitter', 'goabeach'],
    ]);
    const multi = decodeFunctionData({ abi, data: many.data });
    expect(multi.functionName).toBe('multicall');
    expect(
      (multi.args[0] as `0x${string}`[]).map((c) => decodeFunctionData({ abi, data: c }).args[1]),
    ).toEqual(['description', 'com.twitter']);
  });
});
