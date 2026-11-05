/**
 * The print run's pure guards (scripts/lib/cards.ts): the public-origin gate that runs before any mint, the QR-URL
 * check over the rendered sheet (what `page.$$eval('svg[data-qr-url]')` returns), and the expiry label the minted
 * batch carries. Nothing here starts a process; the spawned refusals are in regression/T-85-local-stack.test.ts.
 */
import { describe, expect, it } from 'vitest';

import { assertQrUrls, expiresLabel, qrOrigin } from '../lib/cards.js';

const ORIGIN = 'https://recharge.example';

describe('qrOrigin: NEXT_PUBLIC_PUBLIC_ORIGIN before any card is minted or read', () => {
  it.each([
    undefined,
    '',
    'recharge.example',
    'http://127.0.0.1:3100',
    'http://recharge.example',
    'mailto:ops@recharge.example',
  ])('real cards (--mint, --input) refuse %j', (value) => {
    expect(() => qrOrigin(value, true)).toThrow(
      /^NEXT_PUBLIC_PUBLIC_ORIGIN must be the https:\/\/ origin/,
    );
  });

  it('real cards get the https:// origin (a path or trailing slash is dropped)', () => {
    expect(qrOrigin(`${ORIGIN}/`, true)).toBe(ORIGIN);
    expect(qrOrigin(`${ORIGIN}/card/`, true)).toBe(ORIGIN);
  });

  it('a --count proof runs without it (loopback QR codes), or against whatever origin is set', () => {
    expect(qrOrigin(undefined, false)).toBeUndefined();
    expect(qrOrigin('not a url', false)).toBeUndefined();
    expect(qrOrigin('http://127.0.0.1:3000', false)).toBe('http://127.0.0.1:3000');
    expect(qrOrigin(ORIGIN, false)).toBe(ORIGIN);
  });
});

describe('assertQrUrls: every QR on the rendered sheet carries the public origin', () => {
  const serials = Array.from({ length: 200 }, (_, i) => i.toString(16).padStart(8, '0'));

  it('a sheet rendered through 127.0.0.1 (a build that never saw the origin) throws', () => {
    const loopback = serials.map((s) => `http://127.0.0.1:3100/card/${s}`);
    expect(() => assertQrUrls(loopback, ORIGIN)).toThrow(
      /^QR encodes http:\/\/127\.0\.0\.1:3100\/card\/00000000, want https:\/\/recharge\.example\/card\/<serial>/,
    );
  });

  it('200 matching URLs pass; one stray URL, a wrong path or an empty sheet throws', () => {
    const good = serials.map((s) => `${ORIGIN}/card/${s}`);
    expect(() => assertQrUrls(good, ORIGIN)).not.toThrow();
    expect(() => assertQrUrls([...good, `${ORIGIN}.evil/card/00000000`], ORIGIN)).toThrow(/evil/);
    expect(() => assertQrUrls([`${ORIGIN}/cards/00000000`], ORIGIN)).toThrow(/QR encodes/);
    expect(() => assertQrUrls([], ORIGIN)).toThrow(/QR encodes nothing/);
  });
});

describe('expiresLabel: the mint’s claimBy as "Expires D Mon YYYY" in Asia/Kolkata', () => {
  it('uses the IST calendar day and three-letter months', () => {
    expect(expiresLabel(Date.UTC(2026, 10, 30, 18, 29))).toBe('Expires 30 Nov 2026');
    expect(expiresLabel(Date.UTC(2026, 10, 30, 18, 31))).toBe('Expires 1 Dec 2026'); // 00:01 IST
    expect(expiresLabel(Date.UTC(2026, 8, 15, 12))).toBe('Expires 15 Sep 2026');
  });
});
