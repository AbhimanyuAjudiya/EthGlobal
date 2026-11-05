import { sha256Hex } from '@ethglobal/crypto';

import { assertBlob, MAX_BLOB_BYTES, swarmReference } from '../blob-rules.js';

import type { BlobStore } from '../types.js';

/** Content-addressed in-memory blobs with Swarm-shaped refs (`bzz://<sha256 hex>`). */
export class MemoryBlobStore implements BlobStore {
  readonly #blobs = new Map<string, Uint8Array>();

  async put(bytes: Uint8Array, contentType: string): Promise<{ ref: string }> {
    assertBlob(bytes, contentType, MAX_BLOB_BYTES);
    const reference = sha256Hex(bytes).slice(2);
    this.#blobs.set(reference, bytes.slice());
    return { ref: `bzz://${reference}` };
  }

  async get(ref: string): Promise<Uint8Array | null> {
    return this.#blobs.get(swarmReference(ref))?.slice() ?? null;
  }
}
