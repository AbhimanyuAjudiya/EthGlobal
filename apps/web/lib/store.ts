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
const OWNED = 'owned-plan:';
const CURRENT = 'recharge.currentPlan';
const CHANGED = 'recharge.plans.changed';
const listeners = new Set<() => void>();
const ephemeralLpas = new Map<string, string>();

function changed(): void {
  for (const listener of listeners) listener();
  try {
    localStorage.setItem(CHANGED, String(Date.now()));
  } catch {
    /* device-local convenience */
  }
}

interface EncryptedActivation {
  v: 1;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
  /** Nonextractable, structured-cloned by IndexedDB; no serialized encryption secret. */
  encryptionKey: CryptoKey;
}

export interface PlanMetadata {
  eventId?: string;
  eventName?: string;
  destinationCountry?: string;
  planName?: string;
  createdAt?: number;
}

const activationAad = (key: string) => new TextEncoder().encode(`recharge-activation:v1:${key}`);

async function readActivation(key: string): Promise<string | undefined> {
  if (ephemeralLpas.has(key)) return ephemeralLpas.get(key);
  const stored = await get<string | EncryptedActivation>(`${LPA}${key}`);
  if (typeof stored === 'string') {
    // Preserve older installations while migrating only this plan's plaintext record.
    await plans.saveLpa(key, stored);
    return stored;
  }
  if (stored?.v !== 1) return undefined;
  try {
    const clear = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: stored.iv, additionalData: activationAad(key) },
      stored.encryptionKey,
      stored.ciphertext,
    );
    return new TextDecoder().decode(clear);
  } catch {
    // Keep the encrypted record; an unsupported browser or temporarily unavailable key is not deletion consent.
    return undefined;
  }
}

export const plans = {
  async keys(): Promise<string[]> {
    const [legacy, ownedKeys] = await Promise.all([get<string[]>(KEYS), allKeys()]);
    const owned = await Promise.all(
      ownedKeys
        .filter((key) => key.startsWith(OWNED))
        .map(async (key) => ({
          key: key.slice(OWNED.length),
          at: (await get<{ at: number }>(key))?.at ?? 0,
        })),
    );
    owned.sort((a, b) => b.at - a.at);
    return [...new Set([...owned.map((row) => row.key), ...(legacy ?? [])])];
  },
  async add(key: string): Promise<void> {
    // Independent rows prevent concurrent claims in two tabs overwriting each other's plan list.
    if (!(await plans.owns(key))) {
      await set(`${OWNED}${key}`, { at: Date.now() });
      changed();
    }
  },
  async latest(): Promise<string | undefined> {
    const keys = await plans.keys();
    try {
      const tab = sessionStorage.getItem(CURRENT);
      if (tab && keys.includes(tab)) return tab;
    } catch {
      /* private-mode fallback below */
    }
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
    try {
      sessionStorage.setItem(CURRENT, key);
    } catch {
      /* persistent fallback below */
    }
    await set('currentKey', key);
    changed();
    return true;
  },
  /** The person tapped "Keep this plan on this phone": the key joins this device's plans and becomes current. */
  async adopt(key: string): Promise<void> {
    await plans.add(key);
    await plans.setCurrent(key);
  },
  lpa: readActivation,
  /**
   * Each trip retains its own encrypted activation record. Claiming another plan never erases this one.
   * If persistent encryption is unavailable, retain only an in-memory code and keep delivery recovery armed.
   */
  async saveLpa(key: string, lpa: string): Promise<boolean> {
    try {
      const encryptionKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: activationAad(key) },
        encryptionKey,
        new TextEncoder().encode(lpa),
      );
      await set(`${LPA}${key}`, {
        v: 1,
        iv,
        ciphertext,
        encryptionKey,
      } satisfies EncryptedActivation);
      ephemeralLpas.delete(key);
      return !memory.has(`${LPA}${key}`);
    } catch {
      ephemeralLpas.set(key, lpa);
      await del(`${LPA}${key}`);
      return false;
    }
  },
  /** The eSIM is installed: the activation code has done its job and leaves this device (T-76, RT-W-01). */
  forgetLpa: async (key: string) => {
    ephemeralLpas.delete(key);
    await del(`${LPA}${key}`);
  },
  metadata: (key: string) => get<PlanMetadata>(`plan-metadata:${key}`),
  saveMetadata: async (key: string, metadata: PlanMetadata) => {
    await set(`plan-metadata:${key}`, { ...(await plans.metadata(key)), ...metadata });
    changed();
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key === CHANGED) listener();
    };
    if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(listener);
      if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
    };
  },
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
