/** describeBlobStore: the Swarm-shaped port contract (L13). */
import { describe, expect, it } from 'vitest';

import type { BlobStore } from '../../types.js';

export function describeBlobStore(name: string, make: () => Promise<BlobStore>): void {
  describe(`BlobStore contract: ${name}`, () => {
    it('round trips bytes; refs are bzz://<64 hex>', async () => {
      const store = await make();
      const bytes = new TextEncoder().encode('{"v":1,"box":"sealed"}');
      const { ref } = await store.put(bytes, 'application/json');
      expect(ref).toMatch(/^bzz:\/\/[0-9a-f]{64}$/);
      await expect(store.get(ref)).resolves.toEqual(bytes);
    });

    it('an unknown ref is null; a malformed ref is invalid_request', async () => {
      const store = await make();
      await expect(store.get(`bzz://${'0'.repeat(64)}`)).resolves.toBeNull();
      await expect(store.get('https://evil.example/x')).rejects.toMatchObject({
        code: 'invalid_request',
      });
    });

    it('rejects an empty blob and a bad content type', async () => {
      const store = await make();
      await expect(store.put(new Uint8Array(), 'application/json')).rejects.toMatchObject({
        code: 'invalid_request',
      });
      await expect(store.put(new Uint8Array([1]), 'not a type')).rejects.toMatchObject({
        code: 'invalid_request',
      });
    });
  });
}
