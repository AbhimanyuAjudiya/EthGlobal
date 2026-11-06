/**
 * IndexedDB (one object store, key → value): entitlement keys, the opened LPA per key, pending tx hashes,
 * the agent-policy draft and the last /me snapshot for offline. Pending session keys are encrypted, never raw. Falls back to
 * an in-memory map where IndexedDB is unavailable (private mode, jsdom), so every screen still renders.
 */
import type { MeResponse } from '@ethglobal/protocol/schemas';

import type { Proof } from './proof';

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
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result as T);
        tx.onabort = () => reject(tx.error ?? new Error('indexeddb transaction aborted'));
        tx.onerror = () => reject(tx.error ?? new Error('indexeddb transaction failed'));
        req.onerror = () => reject(req.error ?? new Error('indexeddb'));
      }),
  );
}

export async function get<T>(key: string): Promise<T | undefined> {
  if (memory.has(key)) return memory.get(key) as T;
  try {
    return await run<T | undefined>('readonly', (s) => s.get(key));
  } catch {
    return memory.get(key) as T | undefined;
  }
}

export async function set(key: string, value: unknown): Promise<void> {
  try {
    await run('readwrite', (s) => s.put(value, key));
    memory.delete(key);
  } catch {
    memory.set(key, value);
  }
}

export async function del(key: string): Promise<void> {
  memory.delete(key);
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

/** Every stored key (IndexedDB or the in-memory fallback). */
async function allKeys(): Promise<string[]> {
  try {
    const stored = (await run<IDBValidKey[]>('readonly', (s) => s.getAllKeys())).filter(
      (k): k is string => typeof k === 'string',
    );
    return [...new Set([...stored, ...memory.keys()])];
  } catch {
    return [...memory.keys()];
  }
}

/** Independently keyed operations avoid a shared read/modify/write journal losing another tab's work. */
export async function entries<T>(prefix: string): Promise<Awaited<T>[]> {
  const keys = (await allKeys()).filter((key) => key.startsWith(prefix));
  const values = await Promise.all(keys.map((key) => get<T>(key)));
  return values.filter((value): value is Awaited<T> => value !== undefined);
}

const KEYS = 'entitlementKeys';
const LPA = 'lpa:';

export const plans = {
  async keys(): Promise<string[]> {
    return (await get<string[]>(KEYS)) ?? [];
  },
  async add(key: string): Promise<void> {
    const keys = await plans.keys();
    if (!keys.includes(key)) await set(KEYS, [key, ...keys].slice(0, 20));
  },
  async latest(): Promise<string | undefined> {
    const keys = await plans.keys();
    const current = await get<string>('currentKey');
    // the pointer only ever names a plan this device holds (RT-W-03); a stale or planted value is ignored
    return current && keys.includes(current) ? current : keys[0];
  },
  /** True when this device claimed, bought or was explicitly given the plan (never from a bare URL visit). */
  owns: async (key: string): Promise<boolean> => (await plans.keys()).includes(key),
  /**
   * The plan /install, /agent and the tabs act on. Only a key this device holds can become current (RT-W-03,
   * T-73): a crafted /plan/<key> link never re-points it; adopting a foreign plan is the explicit `adopt`.
   */
  async setCurrent(key: string): Promise<boolean> {
    if (!(await plans.owns(key))) return false;
    await set('currentKey', key);
    return true;
  },
  /** The person tapped "Keep this plan on this phone": the key joins this device's plans and becomes current. */
  async adopt(key: string): Promise<void> {
    await plans.add(key);
    await set('currentKey', key);
  },
  lpa: (key: string) => get<string>(`${LPA}${key}`),
  /**
   * One opened LPA at a time (THREAT-MODEL §8, T-76, RT-W-01): saving a new one deletes every other `lpa:*`.
   * The LPA is a bearer secret; an older plan's code is gone once a newer one arrives on this device.
   */
  async saveLpa(key: string, lpa: string): Promise<boolean> {
    await set(`${LPA}${key}`, lpa);
    for (const k of await allKeys()) if (k.startsWith(LPA) && k !== `${LPA}${key}`) await del(k);
    return !memory.has(`${LPA}${key}`);
  },
  /** The eSIM is installed: the activation code has done its job and leaves this device (T-76, RT-W-01). */
  forgetLpa: (key: string) => del(`${LPA}${key}`),
  snapshot: (key: string) => get<{ at: number; me: MeResponse }>(`me:${key}`),
  saveSnapshot: (key: string, me: MeResponse) => set(`me:${key}`, { at: Date.now(), me }),
  /** The claiming session's public key (A-35): sent with the first PUT /agent/policy of a free entitlement. */
  holder: (key: string) => get<string>(`holder:${key}`),
  saveHolder: (key: string, publicKey: string) => set(`holder:${key}`, publicKey),
  /** The bundle-issued facts the /plan IssuingRows replay once (hash, arkiv key, HCS receipt), set by `deliver`. */
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
  /** The issue's HCS receipt, when the API logged one (`receipt.hcs`). */
  hcs?: { topic: string; sequence: number };
  you: string;
  sponsor?: string;
  shown?: boolean;
  /** The issuing answer as lib/proof.ts redacted it (no activation code, PIN or key): /plan's ProofPanel. */
  proof?: Proof;
}

export interface PendingTx {
  hash: string;
  network: string;
  label: string;
  at: number;
}

export const pending = {
  list: async (): Promise<PendingTx[]> => (await get<PendingTx[]>('pending')) ?? [],
  add: async (tx: PendingTx) =>
    set(
      'pending',
      [tx, ...(await pending.list()).filter((old) => old.hash !== tx.hash)].slice(0, 20),
    ),
  remove: async (hash: string) =>
    set(
      'pending',
      (await pending.list()).filter((tx) => tx.hash !== hash),
    ),
};
