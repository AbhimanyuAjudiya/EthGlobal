/** Swarm references (`bzz://<64 hex>`), shared by MemoryBlobStore and SwarmBlobStore. */
import { AdapterError } from './errors.js';

const REF = /^bzz:\/\/([0-9a-f]{64}|[0-9a-f]{128})$/;

/** The bare Swarm reference of a `bzz://` ref; throws invalid_request on anything else. */
export function swarmReference(ref: string): string {
  const match = REF.exec(ref);
  if (!match?.[1]) throw new AdapterError('blobs', 'invalid_request', 'ref must be bzz://<64 hex>');
  return match[1];
}

export function assertBlob(bytes: Uint8Array, contentType: string, maxBytes: number): void {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw new AdapterError('blobs', 'invalid_request', 'blob must be non-empty bytes');
  }
  if (bytes.length > maxBytes) {
    throw new AdapterError('blobs', 'too_large', `blob is ${bytes.length} bytes (max ${maxBytes})`);
  }
  if (!/^[a-z]+\/[a-z0-9.+-]+$/i.test(contentType)) {
    throw new AdapterError('blobs', 'invalid_request', 'bad content type');
  }
}

/** Blobs here are sealed boxes (a few hundred bytes); 1 MiB is a generous upper bound. */
export const MAX_BLOB_BYTES = 1024 * 1024;
