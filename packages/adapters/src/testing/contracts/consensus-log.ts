/** describeConsensusLog: the HCS-shaped port contract (L12, T-44). */
import { describe, expect, it } from 'vitest';

import type { ConsensusLog } from '../../types.js';

const TOPIC = '0.0.4242';

export function describeConsensusLog(name: string, make: () => Promise<ConsensusLog>): void {
  describe(`ConsensusLog contract: ${name}`, () => {
    it('sequence numbers are monotonic per topic and read returns from a sequence', async () => {
      const log = await make();
      const a = await log.submit(TOPIC, '{"n":1}');
      const b = await log.submit(TOPIC, '{"n":2}');
      const c = await log.submit(TOPIC, '{"n":3}');
      expect([a.sequence, b.sequence, c.sequence]).toEqual([1, 2, 3]);
      expect(a.txId).not.toBe(b.txId);
      const all = await log.read(TOPIC);
      expect(all.map((m) => m.message)).toEqual(['{"n":1}', '{"n":2}', '{"n":3}']);
      const tail = await log.read(TOPIC, 2);
      expect(tail.map((m) => m.sequence)).toEqual([2, 3]);
      for (let i = 1; i < all.length; i += 1)
        expect(all[i]!.sequence).toBeGreaterThan(all[i - 1]!.sequence);
      expect(all[0]!.consensusAt).toBe(a.consensusAt);
    });

    it('an unknown topic reads as empty', async () => {
      const log = await make();
      await expect(log.read('0.0.9999')).resolves.toEqual([]);
    });

    it('rejects > 1024 bytes before submitting (L12), multi-byte characters counted as bytes', async () => {
      const log = await make();
      await expect(log.submit(TOPIC, 'x'.repeat(1025))).rejects.toMatchObject({
        code: 'too_large',
      });
      await expect(log.submit(TOPIC, 'é'.repeat(513))).rejects.toMatchObject({ code: 'too_large' });
      await expect(log.submit(TOPIC, 'x'.repeat(1024))).resolves.toMatchObject({ sequence: 1 });
    });

    it('rejects a malformed topic id and an empty message', async () => {
      const log = await make();
      await expect(log.submit('topic-1', 'x')).rejects.toMatchObject({ code: 'invalid_request' });
      await expect(log.submit(TOPIC, '')).rejects.toMatchObject({ code: 'invalid_request' });
    });
  });
}
