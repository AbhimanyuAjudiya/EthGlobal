/**
 * IndexedDB (one object store, key → value): entitlement keys, the opened LPA per key, pending tx hashes,
 * the agent-policy draft and the last /me snapshot for offline. Never the session secret (T-60). Falls back to
 * an in-memory map where IndexedDB is unavailable (private mode, jsdom), so every screen still renders.
 */
import type { MeResponse } from '@ethglobal/protocol/schemas';

const DB = 'recharge';
const STORE = 'kv';
const memory = new Map<string, unknown>();

let opening: Promise<IDBDatabase | undefined> | undefined;

function open(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(undefined);
  opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
  return opening;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        if (!db) return reject(new Error('no indexeddb'));
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error ?? new Error('indexeddb'));
      }),
  );
}

export async function get<T>(key: string): Promise<T | undefined> {
  try {
    return await run<T | undefined>('readonly', (s) => s.get(key));
  } catch {
    return memory.get(key) as T | undefined;
  }
}

export async function set(key: string, value: unknown): Promise<void> {
  try {
    await run('readwrite', (s) => s.put(value, key));
  } catch {
    memory.set(key, value);
  }
}

export async function del(key: string): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(key));
  } catch {
    memory.delete(key);
  }
}

/** Every stored key and value (the T-60 storage test reads this). */
export async function dump(): Promise<Record<string, unknown>> {
  try {
    const keys = await run<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
    const values = await run<unknown[]>('readonly', (s) => s.getAll());
    return Object.fromEntries(
      keys.map((k, i) => [typeof k === 'string' ? k : JSON.stringify(k), values[i]]),
    );
  } catch {
    return Object.fromEntries(memory);
  }
}

const KEYS = 'entitlementKeys';

export const plans = {
  async keys(): Promise<string[]> {
    return (await get<string[]>(KEYS)) ?? [];
  },
  async add(key: string): Promise<void> {
    const keys = await plans.keys();
    if (!keys.includes(key)) await set(KEYS, [key, ...keys].slice(0, 20));
  },
  async latest(): Promise<string | undefined> {
    return (await get<string>('currentKey')) ?? (await plans.keys())[0];
  },
  /** The plan last opened on /plan/[key]; /install and /agent act on it (they take no URL parameter). */
  setCurrent: (key: string) => set('currentKey', key),
  lpa: (key: string) => get<string>(`lpa:${key}`),
  saveLpa: (key: string, lpa: string) => set(`lpa:${key}`, lpa),
  snapshot: (key: string) => get<{ at: number; me: MeResponse }>(`me:${key}`),
  saveSnapshot: (key: string, me: MeResponse) => set(`me:${key}`, { at: Date.now(), me }),
  /** The bundle-issued facts the /plan IssuingRows replay once (hash, arkiv key), set by /verify. */
  issued: (key: string) => get<IssuedFacts>(`issued:${key}`),
  saveIssued: (key: string, facts: IssuedFacts) => set(`issued:${key}`, facts),
  markIssuedShown: async (key: string) => {
    const facts = await plans.issued(key);
    if (facts) await set(`issued:${key}`, { ...facts, shown: true });
  },
};

export interface IssuedFacts {
  claimTx?: string;
  network?: string;
  arkivKey: string;
  settlement?: string;
  you: string;
  sponsor?: string;
  shown?: boolean;
}

export interface PendingTx {
  hash: string;
  network: string;
  label: string;
  at: number;
}

export const pending = {
  list: async (): Promise<PendingTx[]> => (await get<PendingTx[]>('pending')) ?? [],
  add: async (tx: PendingTx) => set('pending', [tx, ...(await pending.list())].slice(0, 20)),
  remove: async (hash: string) =>
    set(
      'pending',
      (await pending.list()).filter((tx) => tx.hash !== hash),
    ),
};
