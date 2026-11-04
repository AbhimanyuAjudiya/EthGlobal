/** describeLedger: the Ledger port contract, run against InMemoryLedger and ArkivLedger (L1–L3, T-35). */
import { describe, expect, it } from 'vitest';

import { MAX_LEDGER_EXPIRES_IN_S } from '../../ledger-rules.js';

import type { Ledger } from '../../types.js';
import type { fakeClock } from '../clock.js';

export function describeLedger(
  name: string,
  make: () => Promise<{ ledger: Ledger; clock: ReturnType<typeof fakeClock> }>,
): void {
  describe(`Ledger contract: ${name}`, () => {
    it('put/get round trip; get returns copies, not references', async () => {
      const { ledger, clock } = await make();
      const { key, expiresAt } = await ledger.put({
        payload: '{"a":1}',
        annotations: { type: 'receipt', key: 'rcpt:1', day: 20395 },
        expiresIn: 3600,
      });
      expect(expiresAt).toBe(clock.now() + 3_600_000);
      const got = await ledger.get(key);
      expect(got).toMatchObject({
        key,
        payload: '{"a":1}',
        annotations: { type: 'receipt', key: 'rcpt:1', day: 20395 },
        expiresAt,
      });
      got!.annotations.type = 'tampered';
      expect((await ledger.get(key))!.annotations.type).toBe('receipt');
    });

    it('get of an unknown key is null', async () => {
      const { ledger } = await make();
      await expect(ledger.get('0x' + '0'.repeat(64))).resolves.toBeNull();
    });

    it('an entity is dead at exactly expiresAt (L1)', async () => {
      const { ledger, clock } = await make();
      const { key, expiresAt } = await ledger.put({ payload: 'x', expiresIn: 60 });
      expect(expiresAt).toBe(clock.now() + 60_000);
      clock.advance(59_999);
      expect(await ledger.get(key)).not.toBeNull();
      clock.advance(1);
      expect(await ledger.get(key)).toBeNull();
      expect(await ledger.query({ annotations: {} })).toEqual([]);
    });

    it('expired by annotation even if the ledger still has it (T-35)', async () => {
      const { ledger, clock } = await make();
      const { key } = await ledger.put({
        payload: 'x',
        annotations: { type: 'entitlement', key: 'ent:x', expiresAt: clock.now() + 10_000 },
        expiresIn: 600,
      });
      clock.advance(10_000);
      expect(await ledger.get(key)).toBeNull();
      expect(await ledger.query({ annotations: { type: 'entitlement' } })).toEqual([]);
    });

    it('query is AND-equality, does not coerce numbers and strings, honours limit (L3)', async () => {
      const { ledger } = await make();
      await ledger.put({
        payload: '1',
        annotations: { type: 'receipt', key: 'k1', day: 1 },
        expiresIn: 60,
      });
      await ledger.put({
        payload: '2',
        annotations: { type: 'receipt', key: 'k2', day: 1 },
        expiresIn: 60,
      });
      await ledger.put({
        payload: '3',
        annotations: { type: 'gift', key: 'k1', day: 2 },
        expiresIn: 60,
      });
      const both = await ledger.query({ annotations: { type: 'receipt', key: 'k1' } });
      expect(both.map((e) => e.payload)).toEqual(['1']);
      expect(
        (await ledger.query({ annotations: { day: 1 } })).map((e) => e.payload).sort(),
      ).toEqual(['1', '2']);
      expect(await ledger.query({ annotations: { day: '1' } })).toEqual([]);
      expect(await ledger.query({ annotations: { type: 'receipt' }, limit: 1 })).toHaveLength(1);
      expect(await ledger.query({ annotations: { type: 'nonce' } })).toEqual([]);
    });

    it('update without expiresIn keeps the lifetime; with expiresIn resets it from now (L1)', async () => {
      const { ledger, clock } = await make();
      const { key } = await ledger.put({
        payload: 'a',
        annotations: { type: 'gift', key: 'g' },
        expiresIn: 60,
      });
      clock.advance(30_000);
      const r1 = await ledger.update(key, { payload: 'b' });
      expect(r1.expiresAt).toBe(clock.now() + 30_000);
      expect((await ledger.get(r1.key))!.payload).toBe('b');
      const r2 = await ledger.update(
        r1.key,
        { payload: 'c', annotations: { type: 'gift', key: 'g', state: 'claimed' } },
        60,
      );
      expect(r2.expiresAt).toBe(clock.now() + 60_000);
      const got = await ledger.get(r2.key);
      expect(got).toMatchObject({
        payload: 'c',
        annotations: { type: 'gift', key: 'g', state: 'claimed' },
      });
      clock.advance(59_999);
      expect(await ledger.get(r2.key)).not.toBeNull();
    });

    it('update on an expired or unknown key throws not_found and never resurrects (L1)', async () => {
      const { ledger, clock } = await make();
      const { key } = await ledger.put({ payload: 'a', expiresIn: 2 });
      clock.advance(2_001);
      await expect(ledger.update(key, { payload: 'z' }, 60)).rejects.toMatchObject({
        code: 'not_found',
      });
      expect(await ledger.get(key)).toBeNull();
      await expect(ledger.update('0x' + '1'.repeat(64), { payload: 'z' })).rejects.toMatchObject({
        code: 'not_found',
      });
    });

    it('expiresIn must be a positive integer (0, −1, 1.5, NaN) and within the ledger maximum', async () => {
      const { ledger } = await make();
      for (const bad of [0, -1, 1.5, Number.NaN]) {
        await expect(ledger.put({ payload: 'x', expiresIn: bad })).rejects.toMatchObject({
          code: 'invalid_expiry',
        });
      }
      await expect(
        ledger.put({ payload: 'x', expiresIn: MAX_LEDGER_EXPIRES_IN_S + 1 }),
      ).rejects.toMatchObject({
        code: 'invalid_request',
      });
      const ok = await ledger.put({ payload: 'x', expiresIn: MAX_LEDGER_EXPIRES_IN_S });
      expect(ok.expiresAt).not.toBeNull();
    });
  });
}
