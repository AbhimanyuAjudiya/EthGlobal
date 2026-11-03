import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  bytesToHex,
  concat,
  hashToField,
  hexToBytes,
  hmacKey,
  hmacSha256,
  keccak256,
  randomBytes,
  ReplayGuard,
  sha256,
  sha256Hex,
  timingSafeEqual,
  utf8,
  verifyWebhookSignature,
  zeroize,
} from '../src/index.js';

describe('hashes (known-answer vectors)', () => {
  it('sha256 (FIPS 180-2 "abc") for string and bytes input', () => {
    const abc = '0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(sha256Hex('abc')).toBe(abc);
    expect(bytesToHex(sha256(utf8('abc')))).toBe(abc);
  });

  it('keccak256 of the empty string', () => {
    expect(keccak256(new Uint8Array())).toBe(
      '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
    );
  });

  it.each([
    // RFC 4231 test cases 1 and 2
    [
      new Uint8Array(20).fill(0x0b),
      'Hi There',
      '0xb0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    ],
    [
      utf8('Jefe'),
      'what do ya want for nothing?',
      '0x5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    ],
  ])('HMAC-SHA256 RFC 4231 vector %#', (key, data, mac) => {
    expect(bytesToHex(hmacSha256(key, data))).toBe(mac);
    expect(hmacKey(key, data)).toBe(mac);
  });

  it('hmac parts are concatenated (pin ‖ digits)', () => {
    const key = randomBytes(32);
    expect(hmacKey(key, 'pin', '1234')).toBe(hmacKey(key, utf8('pin1234')));
    expect(hmacKey(key, 'pin', '1234')).not.toBe(hmacKey(randomBytes(32), 'pin', '1234'));
  });

  it.each([
    // World ID hash_to_field vectors (API-FACTS §4.2)
    ['', '0x00c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a4'],
    ['test_signal', '0x00c1636e0a961a3045054c4d61374422c31a95846b8442f0927ad2ff1d6112ed'],
    ['hello', '0x001c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36dea'],
  ])('hashToField(%j)', (input, expected) => {
    expect(hashToField(input)).toBe(expected);
  });
});

describe('bytes helpers', () => {
  it('hex round-trips any bytes, and rejects malformed hex', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 96 }), (bytes) => {
        expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
      }),
    );
    for (const bad of ['0x0', 'abcd', '0xzz', '']) {
      expect(() => hexToBytes(bad as `0x${string}`)).toThrow(TypeError);
    }
    expect(hexToBytes('0xABcd')).toEqual(new Uint8Array([0xab, 0xcd]));
  });

  it('timingSafeEqual, concat, zeroize, randomBytes', () => {
    expect(timingSafeEqual(utf8('abc'), utf8('abc'))).toBe(true);
    expect(timingSafeEqual(utf8('abc'), utf8('abd'))).toBe(false);
    expect(timingSafeEqual(utf8('abc'), utf8('ab'))).toBe(false);
    expect(concat(utf8('a'), new Uint8Array([0]), utf8('b'))).toEqual(new Uint8Array([97, 0, 98]));
    const secret = randomBytes(16);
    zeroize(secret);
    expect(secret.every((b) => b === 0)).toBe(true);
    expect(randomBytes(0).length).toBe(0);
    expect(() => randomBytes(-1)).toThrow(RangeError);
  });
});

describe('verifyWebhookSignature', () => {
  const secret = utf8('whsec_test');
  const body = '{"events":[]}';
  const ts = 1_793_707_200; // 2026-11-03T12:00:00Z
  const now = ts * 1000;
  const canonical = `${ts}.${body}`;
  const mac = hmacSha256(secret, canonical);
  const hex = bytesToHex(mac);
  const b64 = btoa(String.fromCharCode(...mac));

  it('accepts hex (with or without 0x), base64 and base64url signatures', () => {
    expect(verifyWebhookSignature(secret, canonical, hex, ts, now)).toBe(true);
    expect(verifyWebhookSignature(secret, canonical, hex.slice(2).toUpperCase(), ts, now)).toBe(
      true,
    );
    expect(verifyWebhookSignature(secret, canonical, b64, ts, now)).toBe(true);
    const url = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=$/, '');
    expect(verifyWebhookSignature(secret, canonical, url, ts, now)).toBe(true);
  });

  it('accepts skew of ±299 s and ±300 s, rejects ±301 s', () => {
    for (const skew of [-300, -299, 299, 300]) {
      expect(verifyWebhookSignature(secret, canonical, hex, ts, now + skew * 1000)).toBe(true);
    }
    for (const skew of [-301, 301, 3600]) {
      expect(verifyWebhookSignature(secret, canonical, hex, ts, now + skew * 1000)).toBe(false);
    }
  });

  it('honours a custom window', () => {
    expect(verifyWebhookSignature(secret, canonical, hex, ts, now + 61_000, 60)).toBe(false);
    expect(verifyWebhookSignature(secret, canonical, hex, ts, now + 59_000, 60)).toBe(true);
  });

  it('rejects millisecond, zero, negative and fractional timestamps', () => {
    const msCanonical = `${now}.${body}`;
    const msSig = bytesToHex(hmacSha256(secret, msCanonical));
    expect(verifyWebhookSignature(secret, msCanonical, msSig, now, now)).toBe(false);
    for (const bad of [0, -1, ts + 0.5, Number.NaN]) {
      expect(verifyWebhookSignature(secret, canonical, hex, bad, now)).toBe(false);
    }
  });

  it('rejects a wrong secret, a tampered body and malformed signatures', () => {
    expect(verifyWebhookSignature(utf8('other'), canonical, hex, ts, now)).toBe(false);
    expect(verifyWebhookSignature(secret, `${ts}.{"events":[1]}`, hex, ts, now)).toBe(false);
    for (const bad of ['', 'zz', hex.slice(0, 64), `${hex}00`, 'sha256=' + hex.slice(2)]) {
      expect(verifyWebhookSignature(secret, canonical, bad, ts, now)).toBe(false);
    }
  });

  it('never accepts a random signature (property)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), (sig) => {
        fc.pre(!timingSafeEqual(sig, mac));
        expect(verifyWebhookSignature(secret, canonical, bytesToHex(sig), ts, now)).toBe(false);
      }),
    );
  });
});

describe('ReplayGuard', () => {
  it('accepts an event id once; a replay inside the window is refused', () => {
    const guard = new ReplayGuard(300);
    const t = 1_793_707_200_000;
    expect(guard.accept('evt_1', t)).toBe(true);
    expect(guard.accept('evt_1', t + 1_000)).toBe(false);
    expect(guard.accept('evt_1', t + 599_000)).toBe(false);
    expect(guard.accept('evt_2', t + 1_000)).toBe(true);
  });

  it('forgets ids after twice the MAC window, when the MAC check refuses them anyway', () => {
    const guard = new ReplayGuard(300);
    const t = 1_793_707_200_000;
    guard.accept('evt_1', t);
    expect(guard.accept('evt_1', t + 600_001)).toBe(true);
  });

  it('a replayed valid delivery: MAC passes, guard refuses; past the window, MAC refuses', () => {
    const secret = utf8('whsec_test');
    const ts = 1_793_707_200;
    const canonical = `${ts}.{}`;
    const sig = bytesToHex(hmacSha256(secret, canonical));
    const guard = new ReplayGuard();
    const deliver = (atMs: number): boolean =>
      verifyWebhookSignature(secret, canonical, sig, ts, atMs) && guard.accept('evt_9', atMs);
    expect(deliver(ts * 1000)).toBe(true);
    expect(deliver(ts * 1000 + 10_000)).toBe(false);
    expect(deliver(ts * 1000 + 301_000)).toBe(false);
  });
});
