import type { AdapterName } from './types.js';

/** Thrown by adapters for caller errors; `code` is stable and safe to branch on. */
export class AdapterError extends Error {
  override readonly name = 'AdapterError';

  constructor(
    readonly adapter: AdapterName,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
