import type { Address, NameResolver } from '../types.js';

export interface NameRecord {
  name: string;
  address: Address;
  text?: Record<string, string>;
}

/** Anvil's deterministic accounts (mnemonic "test test … junk"), handy as fixtures everywhere. */
export const anvilAccounts = [
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
] as const satisfies readonly Address[];

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
