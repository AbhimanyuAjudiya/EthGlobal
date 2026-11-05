/**
 * SwarmBlobStore (Bee API, ethersphere/bee@ed32cfa openapi/Swarm.yaml) [verify Wed]: `POST {bee}/bzz` with
 * `swarm-postage-batch-id` → `{ reference }`; `GET {bee}/bzz/{reference}/` → bytes. ref = `bzz://<reference>`.
 */
import { z } from 'zod';

import { httpJson } from '@ethglobal/protocol/http';

import { assertBlob, MAX_BLOB_BYTES, swarmReference } from '../blob-rules.js';
import { guard } from './errors.js';
import { checkedBaseUrl, joinUrl, withFetch } from './http.js';

import type { BlobStore } from '../types.js';

const uploaded = z
  .object({ reference: z.string().regex(/^([0-9a-f]{64}|[0-9a-f]{128})$/) })
  .loose();

export interface SwarmBlobStoreOptions {
  beeUrl: string;
  postageBatchId: string;
  fetch?: typeof fetch;
}

export class SwarmBlobStore implements BlobStore {
  readonly #opts: SwarmBlobStoreOptions;
  readonly #bee: URL;

  constructor(opts: SwarmBlobStoreOptions) {
    if (!/^[0-9a-f]{64}$/i.test(opts.postageBatchId))
      throw new Error('SWARM_POSTAGE_BATCH must be 64 hex');
    this.#bee = checkedBaseUrl(opts.beeUrl);
    this.#opts = opts;
  }

  async put(bytes: Uint8Array, contentType: string): Promise<{ ref: string }> {
    assertBlob(bytes, contentType, MAX_BLOB_BYTES);
    const { data } = await guard(
      'blobs',
      () =>
        httpJson(joinUrl(this.#bee, '/bzz'), {
          method: 'POST',
          rawBody: bytes,
          headers: {
            'content-type': contentType,
            'swarm-postage-batch-id': this.#opts.postageBatchId.toLowerCase(),
          },
          ...withFetch(this.#opts.fetch),
          schema: uploaded,
        }),
      (status) => (status === 413 ? 'too_large' : status === 402 ? 'unavailable' : undefined),
    );
    return { ref: `bzz://${data.reference}` };
  }

  async get(ref: string): Promise<Uint8Array | null> {
    const reference = swarmReference(ref);
    const { status, data } = await guard('blobs', () =>
      httpJson<Uint8Array>(joinUrl(this.#bee, `/bzz/${reference}/`), {
        ...withFetch(this.#opts.fetch),
        responseType: 'bytes',
        allowStatus: [404],
      }),
    );
    return status === 404 ? null : data;
  }
}
