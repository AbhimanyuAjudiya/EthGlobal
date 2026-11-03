import { anvilAccounts } from '../testing/anvil.js';

import type { Address, NameResolver } from '../types.js';

export { anvilAccounts };

export interface NameRecord {
  name: string;
  address: Address;
  text?: Record<string, string>;
}

export const defaultNameRecords: readonly NameRecord[] = [
  { name: 'alice.eth', address: anvilAccounts[0] },
  { name: 'bob.eth', address: anvilAccounts[1] },
];

/** Lower-cases and trims; full ENSIP-15 normalisation ships with the live adapter. */
export const normalizeName = (name: string): string => name.trim().toLowerCase();

export class MockNameResolver implements NameResolver {
  readonly #records = new Map<string, NameRecord>();

  constructor(records: readonly NameRecord[] = defaultNameRecords) {
    for (const record of records) this.#records.set(normalizeName(record.name), record);
  }

  async resolve(name: string): Promise<Address | null> {
    return this.#records.get(normalizeName(name))?.address ?? null;
  }

  async getText(name: string, key: string): Promise<string | null> {
    return this.#records.get(normalizeName(name))?.text?.[key] ?? null;
  }
}
