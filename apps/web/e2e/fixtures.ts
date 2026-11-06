import { readFileSync } from 'node:fs';

import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

import { API_URL, STATE_FILE } from './env';

import type { E2eState } from './global-setup';

let ipCounter = Math.floor(Math.random() * 200);

/**
 * Each test is its own client address (the API runs with TRUST_PROXY=1 locally), so the per-IP limits on
 * /claim and /challenge (5 and 10 per minute) do not couple unrelated tests. Nothing else is altered.
 */
export async function distinctClient(context: BrowserContext): Promise<void> {
  ipCounter += 1;
  const ip = `198.19.${Math.floor(ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`;
  await context.route(`${API_URL}/**`, (route) =>
    route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } }),
  );
}

export const test = base.extend<{ client: void }>({
  client: [
    async ({ context }, use) => {
      await distinctClient(context);
      await use();
    },
    { auto: true },
  ],
});

export { expect };

export const state = (): E2eState => JSON.parse(readFileSync(STATE_FILE, 'utf8')) as E2eState;

/** Let the API finish once, then drop only its response; subsequent requests must reuse private identity. */
export async function interruptEntitlementOnce(page: Page, path: string) {
  let original: { key: string; sessionPubKey: string; token: string; nonce: string } | undefined;
  await page.route(`${API_URL}${path}`, async (route) => {
    const body = route.request().postDataJSON() as {
      sessionPubKey: string;
      challenge: { nonce: string };
    };
    const token = route.request().headers()['idempotency-key'] ?? '';
    if (original) {
      expect(body.sessionPubKey === original.sessionPubKey, 'original delivery session').toBe(true);
      expect(token === original.token, 'original private recovery token').toBe(true);
      expect(body.challenge.nonce === original.nonce, 'fresh normal authorization challenge').toBe(
        false,
      );
      await route.fallback();
      return;
    }
    expect(token.length).toBeGreaterThanOrEqual(32);
    const response = await route.fetch();
    expect([201, 202]).toContain(response.status());
    const result = (await response.json()) as { entitlementKey: string };
    original = {
      key: result.entitlementKey,
      sessionPubKey: body.sessionPubKey,
      nonce: body.challenge.nonce,
      token,
    };
    await route.abort('failed');
  });
  return () => {
    if (!original) throw new Error('The initial entitlement did not complete.');
    return original.key;
  };
}

/** `/` → "Prove I'm human" → /verify → the local simulated World ID → /plan/<key>. Returns the key. */
export async function claimFreeBundle(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('link', { name: /Prove I.m human →/ }).click();
  await expect(page).toHaveURL(/\/verify$/);
  const button = page.getByRole('button', { name: 'Simulated World ID' });
  await expect(button).toBeEnabled();
  await button.click();
  await page.waitForURL(/\/plan\/.+/, { timeout: 30_000 });
  // the Arkiv fact has landed: its row's avatar turns into the positive check
  await expect(page.getByTestId('issuing-arkiv').locator('.avatar')).toHaveAttribute(
    'data-tone',
    'positive',
  );
  return decodeURIComponent(new URL(page.url()).pathname.replace(/^\/plan\//, ''));
}

/** A JSON call straight to the API (assertions only; the app itself goes through lib/api.ts). */
export async function apiGet<T>(page: Page, path: string): Promise<T> {
  const res = await page.request.get(`${API_URL}${path}`, {
    headers: { 'x-forwarded-for': `198.20.0.${(ipCounter % 250) + 1}` },
  });
  expect(res.ok(), `${path} → ${res.status()}`).toBe(true);
  return (await res.json()) as T;
}

/** Every value the app keeps in IndexedDB ('recharge' / 'kv'), as strings (the T-60 storage checks). */
export async function storedValues(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('recharge');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('indexeddb'));
    });
    const values = await new Promise<unknown[]>((resolve) => {
      const r = db.transaction('kv').objectStore('kv').getAll();
      r.onsuccess = () => resolve(r.result);
    });
    return values.map((v) => (typeof v === 'string' ? v : JSON.stringify(v)));
  });
}

/**
 * The activation codes the device holds, decrypted the way lib/store.ts reads them back ('lpa:<key>' records, AES-GCM
 * under a nonextractable key, the plan key as AAD). A plaintext record fails here: LPAs are encrypted at rest.
 */
export async function storedLpas(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('recharge');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('indexeddb'));
    });
    const read = <T>(req: () => IDBRequest<T>) =>
      new Promise<T>((resolve) => {
        const r = req();
        r.onsuccess = () => resolve(r.result);
      });
    const store = () => db.transaction('kv').objectStore('kv');
    const keys = await read(() => store().getAllKeys());
    const lpas: string[] = [];
    for (const key of keys) {
      if (typeof key !== 'string' || !key.startsWith('lpa:')) continue;
      const record = (await read(() => store().get(key))) as {
        v?: number;
        iv: Uint8Array<ArrayBuffer>;
        ciphertext: ArrayBuffer;
        encryptionKey: CryptoKey;
      };
      if (record?.v !== 1) throw new Error(`${key.slice(0, 12)}… is not an encrypted activation`);
      const clear = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: record.iv,
          additionalData: new TextEncoder().encode(
            `recharge-activation:v1:${key.slice('lpa:'.length)}`,
          ),
        },
        record.encryptionKey,
        record.ciphertext,
      );
      lpas.push(new TextDecoder().decode(clear));
    }
    return lpas;
  });
}

/** The page never scrolls sideways at this width. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0);
}
