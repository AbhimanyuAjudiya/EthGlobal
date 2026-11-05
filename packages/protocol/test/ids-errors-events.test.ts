import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ADAPTER_CODE_MAP, ERROR_CODES, isErrorCode, RechargeError } from '../src/errors.js';
import * as events from '../src/events.js';
import {
  ANN,
  dayBucket,
  ENTITY_TYPES,
  hourBucket,
  isEvmNetwork,
  isHederaNetwork,
  isHex,
  KEY_PREFIXES,
  keys,
  NETWORKS,
  TESTNET_NETWORKS,
  USDC_ASSET,
  USDC_EIP712_DOMAIN,
  usdcAssetFor,
  type Hex,
} from '../src/ids.js';
import { caipNetworkSchema, hcsMessageSchema } from '../src/schemas/index.js';

const hex32 = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((b): Hex => `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`);

describe('ids', () => {
  it('networks are CAIP-2 and classified by namespace', () => {
    for (const n of Object.values(NETWORKS))
      expect(caipNetworkSchema.safeParse(n).success).toBe(true);
    expect(isEvmNetwork(NETWORKS.anvil) && isEvmNetwork(NETWORKS.baseSepolia)).toBe(true);
    expect(isHederaNetwork(NETWORKS.hederaTestnet)).toBe(true);
    expect(isEvmNetwork('hedera:testnet') || isHederaNetwork('eip155:296')).toBe(false);
    expect(TESTNET_NETWORKS).toEqual(['eip155:31337', 'eip155:84532', 'hedera:testnet']);
  });

  it('USDC asset ids and per-chain EIP-712 domains (A-20, A-21)', () => {
    expect(USDC_ASSET['hedera:testnet']).toBe('0.0.429274');
    expect(USDC_EIP712_DOMAIN['eip155:84532']).toEqual({ name: 'USDC', version: '2' });
    expect(USDC_EIP712_DOMAIN['eip155:31337']).toEqual({ name: 'USD Coin', version: '2' });
  });

  it('mainnet USDC: hedera:mainnet is HTS 0.0.456858, eip155:8453 is Base USDC; usdcAssetFor is undefined elsewhere', () => {
    expect(USDC_ASSET['hedera:mainnet']).toBe('0.0.456858');
    expect(USDC_ASSET['eip155:8453']).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(usdcAssetFor('eip155:8453')).toBe(USDC_ASSET['eip155:8453']);
    expect(usdcAssetFor('hedera:mainnet')).toBe('0.0.456858');
    expect(usdcAssetFor('eip155:1')).toBeUndefined();
    expect(USDC_EIP712_DOMAIN['eip155:8453']).toEqual({ name: 'USD Coin', version: '2' });
  });

  it('logical keys use the §9 prefixes and lower-case their hex parts', () => {
    const h: Hex = `0x${'AB'.repeat(32)}`;
    const built = [
      [keys.entitlementFree(h), KEY_PREFIXES.entitlementFree],
      [keys.entitlementPaid('0xABC', h), KEY_PREFIXES.entitlementPaid],
      [keys.entitlementGift(h), KEY_PREFIXES.entitlementGift],
      [keys.gift(h), KEY_PREFIXES.gift],
      [keys.nonce(h), KEY_PREFIXES.nonce],
      [keys.receipt('eip155:31337', '0xDEAD'), KEY_PREFIXES.receipt],
      [keys.campaign(h), KEY_PREFIXES.campaign],
      [keys.agentPolicy('ent:v1:x'), KEY_PREFIXES.agentPolicy],
      [keys.claim(h), KEY_PREFIXES.claim],
    ] as const;
    for (const [key, prefix] of built) expect(key.startsWith(prefix)).toBe(true);
    expect(Object.values(KEY_PREFIXES)).toEqual([
      'ent:v1:',
      'paid:',
      'giftent:',
      'gift:',
      'nonce:',
      'rcpt:',
      'camp:',
      'policy:',
      'claim:',
    ]);
    expect(keys.claim(h)).toBe(`claim:0x${'ab'.repeat(32)}`);
    expect(keys.entitlementPaid('0xABC', h)).toBe(`paid:0xabc:0x${'ab'.repeat(32)}`);
    expect(keys.receipt('eip155:31337', '0xDEAD')).toBe('rcpt:eip155:31337:0xdead');
  });

  it('property: keys are case-insensitive in their hex inputs', () => {
    fc.assert(
      fc.property(hex32, (h) => {
        const upper: Hex = `0x${h.slice(2).toUpperCase()}`;
        expect(keys.gift(upper)).toBe(keys.gift(h));
        expect(keys.nonce(upper)).toBe(keys.nonce(h));
        expect(keys.campaign(upper)).toBe(keys.campaign(h));
      }),
    );
  });

  it('property: day and hour buckets partition time', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4e12 }), (ms) => {
        expect(dayBucket(ms)).toBe(Math.floor(ms / 86_400_000));
        expect(hourBucket(ms) * 3_600_000).toBeLessThanOrEqual(ms);
        expect((hourBucket(ms) + 1) * 3_600_000).toBeGreaterThan(ms);
        expect(Math.floor(hourBucket(ms) / 24)).toBe(dayBucket(ms));
      }),
    );
    expect(dayBucket(Date.UTC(2026, 10, 3, 23, 59))).toBe(dayBucket(Date.UTC(2026, 10, 3)));
  });

  it('isHex', () => {
    expect(isHex('0x')).toBe(true);
    expect(isHex('0xAbC1')).toBe(true);
    for (const bad of ['abc', '0xg', 1, null]) expect(isHex(bad)).toBe(false);
  });

  it('annotation names never name a secret (T-37)', () => {
    const values = Object.values(ANN).join(' ').toLowerCase();
    for (const banned of ['nullifier', 'iccid ', 'pin ', 'lpa', 'secret'])
      expect(values).not.toContain(banned);
    expect(ENTITY_TYPES).toHaveLength(7); // A-33: + 'claim'
  });
});

describe('errors', () => {
  it('every code has an HTTP status', () => {
    for (const [code, status] of Object.entries(ERROR_CODES)) {
      expect(Number.isInteger(status) && status >= 200 && status < 600).toBe(true);
      expect(isErrorCode(code)).toBe(true);
    }
    expect(isErrorCode('nope')).toBe(false);
    expect(isErrorCode('constructor')).toBe(false);
  });

  it('every ADAPTER_CODE_MAP value is a code; spec mappings hold', () => {
    for (const value of Object.values(ADAPTER_CODE_MAP)) expect(isErrorCode(value)).toBe(true);
    expect(ADAPTER_CODE_MAP.already_verified).toBe('replay');
    expect(ADAPTER_CODE_MAP.invalid_response).toBe('reseller_unavailable');
    expect(ADAPTER_CODE_MAP.nonce_already_used).toBe('invalid_payment');
    expect(ADAPTER_CODE_MAP.unavailable).toBe('ledger_unavailable');
    expect(Object.isFrozen(ADAPTER_CODE_MAP)).toBe(true);
  });

  it('RechargeError carries code, status, details and retryable', () => {
    const e = new RechargeError('ledger_unavailable', 'arkiv down', { op: 'put' }, true);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('RechargeError');
    expect([e.code, e.status, e.retryable, e.message]).toEqual([
      'ledger_unavailable',
      503,
      true,
      'arkiv down',
    ]);
    expect(e.details).toEqual({ op: 'put' });
    const d = new RechargeError('replay');
    expect([d.message, d.status, d.retryable]).toEqual(['replay', 409, false]);
  });
});

describe('events', () => {
  it('HCS types are exactly the hcsMessageSchema discriminators', () => {
    const discriminators = hcsMessageSchema.options.map((o) => o.shape.t.value);
    expect([...events.HCS_TYPES].sort()).toEqual([...discriminators].sort());
  });

  it('lists are unique and match §9', () => {
    for (const list of [
      events.DATADROP_EVENTS,
      events.DATADROP_ERRORS,
      events.LOG_EVENTS,
      events.USDC3009_EVENTS,
    ]) {
      expect(new Set(list).size).toBe(list.length);
    }
    expect(events.DATADROP_EVENTS).toContain('Claimed');
    expect(events.DATADROP_ERRORS).toContain('HourlyCap');
    expect([
      events.REQUEST_ID_HEADER,
      events.IDEMPOTENCY_KEY_HEADER,
      events.SPONSOR_AUTH_SCHEME,
    ]).toEqual(['X-Request-Id', 'Idempotency-Key', 'Recharge-Sponsor']);
  });
});
