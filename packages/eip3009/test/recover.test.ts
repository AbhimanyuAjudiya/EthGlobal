import fc from 'fast-check';
import { keccak256, numberToHex, sliceHex, toHex, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';

import { Eip3009Error, normalizeSignature, parseSignature, recoverSigner } from '../src/index.js';
import { human, HUMAN_KEY, N } from './helpers.js';
import { sign } from 'viem/accounts';

const digest = keccak256(toHex('recharge'));

async function signed(hash: Hex = digest): Promise<{ r: Hex; s: Hex; v: number; yParity: number }> {
  const sig = await sign({ hash, privateKey: HUMAN_KEY });
  return { r: sig.r, s: sig.s, v: 27 + (sig.yParity ?? 0), yParity: sig.yParity ?? 0 };
}
const join = (r: Hex, s: Hex, v: number): Hex => `${r}${s.slice(2)}${v.toString(16).padStart(2, '0')}` as Hex;

describe('recoverSigner (T-17)', () => {
  it('recovers a 65-byte v ∈ {27,28} signature', async () => {
    const { r, s, v } = await signed();
    await expect(recoverSigner(digest, join(r, s, v))).resolves.toBe(human.address);
  });

  it('normalises v = 0/1 to 27/28', async () => {
    const { r, s, yParity } = await signed();
    const sig = join(r, s, yParity);
    await expect(recoverSigner(digest, sig)).resolves.toBe(human.address);
    expect(normalizeSignature(sig)).toBe(join(r, s, 27 + yParity));
  });

  it('accepts the EIP-2098 64-byte compact form', async () => {
    const { r, s, yParity } = await signed();
    const vs = BigInt(s) | (BigInt(yParity) << 255n);
    const compact = `${r}${numberToHex(vs, { size: 32 }).slice(2)}` as Hex;
    await expect(recoverSigner(digest, compact)).resolves.toBe(human.address);
    expect(parseSignature(compact).yParity).toBe(yParity);
  });

  it('high-s rejected (A17): the malleable twin of a valid signature never recovers', async () => {
    const { r, s, yParity } = await signed();
    const twin = numberToHex(N - BigInt(s), { size: 32 });
    const flipped = join(r, twin, 27 + (1 - yParity));
    await expect(recoverSigner(digest, flipped)).rejects.toMatchObject({
      code: 'invalid_signature',
      message: expect.stringMatching(/high-s/),
    });
  });

  it.each([
    ['bad v', (r: Hex, s: Hex) => join(r, s, 29)],
    ['bad v 2', (r: Hex, s: Hex) => join(r, s, 2)],
    ['63 bytes', (r: Hex, s: Hex) => sliceHex(join(r, s, 27), 0, 63)],
    ['66 bytes', (r: Hex, s: Hex) => `${join(r, s, 27)}00` as Hex],
    ['r = 0', (_r: Hex, s: Hex) => join(numberToHex(0n, { size: 32 }), s, 27)],
    ['s = 0', (r: Hex) => join(r, numberToHex(0n, { size: 32 }), 27)],
    ['r ≥ n', (_r: Hex, s: Hex) => join(numberToHex(N, { size: 32 }), s, 27)],
    ['s ≥ n', (r: Hex) => join(r, numberToHex(N, { size: 32 }), 27)],
    ['not hex', () => '0xzz' as Hex],
  ])('%s ⇒ invalid_signature', async (_name, make) => {
    const { r, s } = await signed();
    await expect(recoverSigner(digest, make(r, s))).rejects.toBeInstanceOf(Eip3009Error);
  });

  it('rejects a digest that is not 32 bytes', async () => {
    const { r, s, v } = await signed();
    await expect(recoverSigner('0x1234', join(r, s, v))).rejects.toMatchObject({ code: 'invalid_signature' });
  });

  it('property: every signature by the key recovers to its address, in all three encodings', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 1, maxLength: 64 }), async (bytes) => {
        const hash = keccak256(bytes);
        const { r, s, yParity } = await signed(hash);
        const vs = BigInt(s) | (BigInt(yParity) << 255n);
        for (const sig of [
          join(r, s, 27 + yParity),
          join(r, s, yParity),
          `${r}${numberToHex(vs, { size: 32 }).slice(2)}` as Hex,
        ]) {
          expect(await recoverSigner(hash, sig)).toBe(human.address);
        }
      }),
      { numRuns: 25 },
    );
  });
});
