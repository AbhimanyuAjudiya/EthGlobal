/**
 * InventoryReseller (INTERFACES §3.3; T-41): pre-bought profiles in a file sealed to the server key
 * (`sealToServer(key, JSON.stringify(profiles), INVENTORY_AAD)`), git-ignored. order() marks a profile consumed and
 * rewrites the file atomically (tmp → rename) BEFORE returning, so a crash never re-issues it; in-process orders are
 * serialised, so two concurrent orders get two distinct profiles. The file never holds an LPA in clear.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs';

import { z } from 'zod';

import { openFromServer, sealToServer, utf8 } from '@ethglobal/crypto';
import { lpaSchema, sealedBoxSchema } from '@ethglobal/protocol/schemas';

import { AdapterError } from '../errors.js';
import { assertCountryCode, assertIccid, assertLpa, safePlanName } from '../reseller-rules.js';

import type {
  EsimPlan,
  EsimCancellationEvidence,
  EsimProfile,
  EsimUsage,
  Reseller,
  UsageEvent,
  WebhookVerdict,
} from '../types.js';

export const INVENTORY_AAD = utf8('recharge/inventory/v1');

export const inventoryEntrySchema = z.object({
  iccid: z.string().regex(/^\d{18,22}$/),
  lpa: lpaSchema,
  planId: z.string().min(1).max(64),
  /** Existing sealed stock predates destination metadata and is India-only. */
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  dataMb: z.int().positive().max(1_000_000),
  validityDays: z.int().positive().max(365),
  /** What the profile cost (digits, micro-USD); defaults to 1 (sunk cost, but never "free"). */
  wholesaleUsd6: z
    .string()
    .regex(/^\d{1,15}$/)
    .optional(),
  consumedBy: z.string().max(200).optional(),
  orderId: z.string().max(64).optional(),
});
export type InventoryEntry = z.infer<typeof inventoryEntrySchema>;
const inventorySchema = z.array(inventoryEntrySchema).max(10_000);

/** Seals an inventory for `file` (the operator tool and tests use it; the plaintext never touches disk). */
export function sealInventory(entries: InventoryEntry[], sealKey: Uint8Array): string {
  return `${JSON.stringify(sealToServer(sealKey, JSON.stringify(inventorySchema.parse(entries)), INVENTORY_AAD))}\n`;
}

export interface InventoryResellerOptions {
  file: string;
  sealKey: Uint8Array;
  now: () => number;
}

export class InventoryReseller implements Reseller {
  readonly name = 'inventory' as const;
  readonly #opts: InventoryResellerOptions;
  #lock: Promise<unknown> = Promise.resolve();

  /** Opens the file now: a wrong key or a corrupt file fails at boot, not at the first order on stage (L9). */
  constructor(opts: InventoryResellerOptions) {
    this.#opts = opts;
    this.#read();
  }

  #read(): InventoryEntry[] {
    let text: string;
    try {
      text = readFileSync(this.#opts.file, 'utf8');
    } catch {
      throw new AdapterError('reseller', 'unavailable', 'inventory file not readable');
    }
    try {
      const box = sealedBoxSchema.parse(JSON.parse(text));
      return inventorySchema.parse(
        JSON.parse(openFromServer(this.#opts.sealKey, box as never, INVENTORY_AAD)),
      );
    } catch {
      throw new AdapterError(
        'reseller',
        'unavailable',
        'inventory file does not open with INVENTORY_SEAL_KEY',
      );
    }
  }

  #write(entries: InventoryEntry[]): void {
    const tmp = `${this.#opts.file}.${process.pid}.tmp`;
    writeFileSync(tmp, sealInventory(entries, this.#opts.sealKey), { mode: 0o600 });
    renameSync(tmp, this.#opts.file);
  }

  #serial<T>(fn: () => T): Promise<T> {
    const next = this.#lock.then(fn);
    this.#lock = next.catch(() => undefined);
    return next;
  }

  async plans(country: string): Promise<EsimPlan[]> {
    assertCountryCode(country);
    const free = this.#read().filter((e) => !e.consumedBy && (e.country ?? 'IN') === country);
    const byPlan = new Map<string, InventoryEntry>();
    for (const e of free) if (!byPlan.has(e.planId)) byPlan.set(e.planId, e);
    return [...byPlan.values()].map((e) => ({
      id: e.planId,
      provider: 'inventory' as const,
      name: safePlanName(`Pre-bought ${e.dataMb} MB · ${e.validityDays} days`),
      country,
      dataMb: e.dataMb,
      validityDays: e.validityDays,
      wholesaleUsd6: BigInt(e.wholesaleUsd6 ?? '1'),
      activation: { startsOn: 'unknown' },
      cancellation: 'unsupported',
    }));
  }

  order(planId: string, opts: { idempotencyKey: string }): Promise<EsimProfile> {
    const key = opts.idempotencyKey;
    return this.#serial(() => {
      if (!key) throw new AdapterError('reseller', 'invalid_request', 'idempotencyKey is required');
      const entries = this.#read();
      const done = entries.find((e) => e.consumedBy === key);
      if (done) return this.#profile(done);
      const free = entries.find((e) => !e.consumedBy && e.planId === planId);
      if (!free)
        throw new AdapterError(
          'reseller',
          'unavailable',
          `inventory has no ${planId} profile left`,
        );
      free.consumedBy = key;
      free.orderId = `inv-${entries
        .filter((e) => e.consumedBy)
        .length.toString()
        .padStart(6, '0')}`;
      this.#write(entries); // consumed on disk before the LPA leaves this process
      return this.#profile(free);
    });
  }

  async recoverOrder(idempotencyKey: string): Promise<EsimProfile | null> {
    const entry = this.#read().find((e) => e.consumedBy === idempotencyKey);
    return entry ? this.#profile(entry) : null;
  }

  async canTopUp(iccid: string): Promise<boolean> {
    const issued = this.#read().some((entry) => entry.iccid === iccid && entry.consumedBy);
    if (!issued) throw new AdapterError('reseller', 'not_found', 'unknown ICCID');
    return false;
  }

  #profile(e: InventoryEntry): EsimProfile {
    return {
      iccid: assertIccid(e.iccid),
      lpa: assertLpa(e.lpa),
      planId: e.planId,
      provider: 'inventory',
      orderId: e.orderId ?? 'inv',
      status: 'ready',
    };
  }

  async topUp(
    _iccid: string,
    _mb: number,
    _opts: { idempotencyKey: string },
  ): Promise<{ orderId: string; totalMb: number }> {
    throw new AdapterError('reseller', 'unavailable', 'inventory profiles cannot be topped up');
  }

  /** Pre-bought stock is never refunded: a cancel is refused, the profile stays issued. */
  async cancellationEvidence(iccid: string): Promise<EsimCancellationEvidence> {
    if (!this.#read().some((entry) => entry.iccid === iccid))
      throw new AdapterError('reseller', 'not_found', 'unknown ICCID');
    return { provider: this.name, status: 'ineligible', observedAt: this.#opts.now() };
  }

  async cancel(_iccid: string, _opts: { idempotencyKey: string }): Promise<void> {
    throw new AdapterError('reseller', 'not_implemented', 'inventory profiles cannot be refunded');
  }

  /** No live usage source: usedMb 0 (the API labels inventory usage "simulated"). */
  async usage(iccid: string): Promise<EsimUsage> {
    const e = this.#read().find((x) => x.iccid === iccid && x.consumedBy);
    if (!e) throw new AdapterError('reseller', 'not_found', 'unknown ICCID');
    return { iccid, usedMb: 0, totalMb: e.dataMb, asOf: this.#opts.now(), status: 'ready' };
  }

  verifyWebhook(
    _rawBody: string,
    _headers: Record<string, string | undefined>,
    _now: number,
  ): WebhookVerdict {
    return { ok: false, reason: 'bad_signature' };
  }

  parseWebhook(_rawBody: string): UsageEvent[] {
    return [];
  }
}
