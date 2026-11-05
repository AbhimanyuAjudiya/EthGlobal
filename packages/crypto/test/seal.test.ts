import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  bytesToHex,
  generateSessionKeypair,
  hexToBytes,
  lpaAad,
  openFromServer,
  openLpa,
  randomBytes,
  SealError,
  sealLpa,
  sealToServer,
  type SealedBox,
} from '../src/index.js';

const LPA = 'LPA:1$smdp.example.com$ABCD-1234-EFGH';
const NONCE = '0x' + 'ab'.repeat(32);
const aad = lpaAad(`0x${'ab'.repeat(32)}`, 'ent:v1:0x01');

/** Flips one bit of the byte at `index` of a hex field. */
function flip(hex: `0x${string}`, index: number): `0x${string}` {
  const bytes = hexToBytes(hex);
  bytes[index] = (bytes[index] ?? 0) ^ 0x01;
  return bytesToHex(bytes);
}

describe('sealLpa / openLpa', () => {
  it('round-trips for any UTF-8 string and AAD', () => {
    const { publicKey, secretKey } = generateSessionKeypair();
    fc.assert(
      fc.property(
        fc.string({ unit: 'grapheme' }),
        fc.uint8Array({ maxLength: 64 }),
        (text, extra) => {
          expect(openLpa(sealLpa(text, publicKey, extra), secretKey, extra)).toBe(text);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('produces a well-formed box with a fresh ephemeral key and nonce', () => {
    const { publicKey } = generateSessionKeypair();
    const a = sealLpa(LPA, publicKey, aad);
    const b = sealLpa(LPA, publicKey, aad);
    expect(a).toMatchObject({ v: 1 });
    expect(a.epk).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a.nonce).toMatch(/^0x[0-9a-f]{48}$/);
    expect(hexToBytes(a.ct).length).toBe(new TextEncoder().encode(LPA).length + 16);
    expect(a.epk).not.toBe(b.epk);
    expect(a.ct).not.toBe(b.ct);
  });

  it('uses 10^4 distinct nonces (shared nonce path) and distinct LPA nonces and ephemeral keys', () => {
    const key = randomBytes(32);
    const nonces = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) nonces.add(sealToServer(key, 'x', aad).nonce);
    expect(nonces.size).toBe(10_000);
    const { publicKey } = generateSessionKeypair();
    const boxes = Array.from({ length: 500 }, () => sealLpa('x', publicKey, aad));
    expect(new Set(boxes.map((b) => b.nonce)).size).toBe(500);
    expect(new Set(boxes.map((b) => b.epk)).size).toBe(500);
  }, 30_000);

  it('rejects the wrong secret key', () => {
    const alice = generateSessionKeypair();
    const mallory = generateSessionKeypair();
    const box = sealLpa(LPA, alice.publicKey, aad);
    expect(() => openLpa(box, mallory.secretKey, aad)).toThrow(SealError);
  });

  it('rejects the wrong AAD (other nonce, other entitlement, empty)', () => {
    const { publicKey, secretKey } = generateSessionKeypair();
    const box = sealLpa(LPA, publicKey, aad);
    for (const other of [
      lpaAad(`0x${'cd'.repeat(32)}`, 'ent:v1:0x01'),
      lpaAad(`0x${'ab'.repeat(32)}`, 'ent:v1:0x02'),
      new Uint8Array(),
    ]) {
      expect(() => openLpa(box, secretKey, other)).toThrow(SealError);
    }
  });

  it('rejects any single flipped bit in ct, nonce or epk', () => {
    const { publicKey, secretKey } = generateSessionKeypair();
    const box = sealLpa(LPA, publicKey, aad);
    const ctLength = hexToBytes(box.ct).length;
    fc.assert(
      fc.property(
        fc.constantFrom<'ct' | 'nonce' | 'epk'>('ct', 'nonce', 'epk'),
        fc.nat(),
        (field, n) => {
          const length = field === 'ct' ? ctLength : field === 'nonce' ? 24 : 32;
          const tampered: SealedBox = { ...box, [field]: flip(box[field], n % length) };
          expect(() => openLpa(tampered, secretKey, aad)).toThrow(SealError);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('rejects truncated and malformed boxes with SealError', () => {
    const { publicKey, secretKey } = generateSessionKeypair();
    const box = sealLpa(LPA, publicKey, aad);
    const bad: SealedBox[] = [
      { ...box, ct: box.ct.slice(0, -2) as `0x${string}` },
      { ...box, ct: '0x' },
      { ...box, nonce: '0x00' },
      { ...box, epk: 'nothex' as `0x${string}` },
      { ...box, v: 2 as 1 },
    ];
    for (const b of bad) expect(() => openLpa(b, secretKey, aad)).toThrow(SealError);
  });

  it('rejects keys of the wrong length and the all-zero (low-order) public key', () => {
    const { secretKey } = generateSessionKeypair();
    expect(() => sealLpa(LPA, new Uint8Array(31), aad)).toThrow(SealError);
    expect(() => sealLpa(LPA, new Uint8Array(32), aad)).toThrow(SealError);
    expect(() =>
      openLpa(sealLpa(LPA, generateSessionKeypair().publicKey, aad), secretKey.slice(1), aad),
    ).toThrow(SealError);
  });

  it('lpaAad binds the lower-cased nonce and the entitlement key', () => {
    expect(new TextDecoder().decode(lpaAad(`0x${'AB'.repeat(32)}`, 'paid:k'))).toBe(
      `${NONCE}|paid:k`,
    );
  });
});

describe('sealToServer / openFromServer', () => {
  const key = randomBytes(32);
  const iccidAad = new TextEncoder().encode('iccid|ent:v1:0x01');

  it('round-trips with a zero-filled epk', () => {
    const box = sealToServer(key, '8991000000000000001', iccidAad);
    expect(box.epk).toBe(`0x${'00'.repeat(32)}`);
    expect(openFromServer(key, box, iccidAad)).toBe('8991000000000000001');
  });

  it('rejects the wrong key, wrong AAD, tampering, a session box and a short key', () => {
    const box = sealToServer(key, '8991000000000000001', iccidAad);
    expect(() => openFromServer(randomBytes(32), box, iccidAad)).toThrow(SealError);
    expect(() => openFromServer(key, box, new Uint8Array([1]))).toThrow(SealError);
    expect(() => openFromServer(key, { ...box, ct: flip(box.ct, 0) }, iccidAad)).toThrow(SealError);
    const session = sealLpa('x', generateSessionKeypair().publicKey, iccidAad);
    expect(() => openFromServer(key, session, iccidAad)).toThrow(/not a server-sealed box/);
    expect(() => sealToServer(new Uint8Array(16), 'x', iccidAad)).toThrow(SealError);
  });
});
