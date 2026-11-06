/**
 * W5 (LPA and key leakage through browser plumbing: T-31, T-60, T-61, T-76) and W6 (/install, T-62).
 * Runs the real claim flow against the real local API, captures the sealed box and the opened LPA from the wire,
 * then inspects every browser store, every outgoing request, console and page errors.
 */
import { LOCAL_LPA } from './rt-payloads';
import { API_URL } from '../../e2e/env';
import {
  claimFreeBundle,
  distinctClient,
  expect,
  state,
  storedValues,
  test,
} from '../../e2e/fixtures';

import type { Page } from '@playwright/test';

const IOS_17_4 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

interface Wire {
  urls: string[];
  headers: string[];
  bodies: string[];
  console: string[];
  sealed: string[];
}

/** Records every request (URL, headers, post body), console line and page error, and the sealed boxes served. */
function tap(page: Page): Wire {
  const wire: Wire = { urls: [], headers: [], bodies: [], console: [], sealed: [] };
  page.on('request', (r) => {
    wire.urls.push(r.url());
    wire.headers.push(JSON.stringify(r.headers()));
    const body = r.postData();
    if (body) wire.bodies.push(body);
  });
  page.on('console', (m) => wire.console.push(m.text()));
  page.on('pageerror', (e) => wire.console.push(String(e)));
  page.on('response', async (r) => {
    if (!/\/(claim|card\/redeem|gift\/claim|esim\/provision)$/.test(new URL(r.url()).pathname))
      return;
    try {
      const body = (await r.json()) as { sealedLpa?: unknown };
      if (body.sealedLpa) wire.sealed.push(JSON.stringify(body.sealedLpa));
    } catch {
      // not JSON
    }
  });
  return wire;
}

/** localStorage, sessionStorage, every IndexedDB store and every Cache Storage entry, as one string. */
async function dumpAll(page: Page): Promise<{
  local: Record<string, string>;
  session: Record<string, string>;
  idb: string[];
  caches: string[];
}> {
  const web = await page.evaluate(async () => {
    const local = Object.fromEntries(
      Object.keys(localStorage).map((k) => [k, localStorage.getItem(k) ?? '']),
    );
    const session = Object.fromEntries(
      Object.keys(sessionStorage).map((k) => [k, sessionStorage.getItem(k) ?? '']),
    );
    const out: string[] = [];
    for (const info of await indexedDB.databases()) {
      if (!info.name) continue;
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open(info.name!);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error ?? new Error('indexeddb'));
      });
      for (const store of [...db.objectStoreNames]) {
        const all = await new Promise<unknown[]>((res) => {
          const r = db.transaction(store).objectStore(store).getAll();
          r.onsuccess = () => res(r.result);
        });
        for (const v of all)
          out.push(`${info.name}/${store}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
      }
      db.close();
    }
    const cached: string[] = [];
    if ('caches' in self)
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const req of await cache.keys()) {
          const res = await cache.match(req);
          cached.push(`${name} ${req.url} ${(await res?.clone().text())?.slice(0, 20000) ?? ''}`);
        }
      }
    return { local, session, idb: out, caches: cached };
  });
  return web;
}

const lpaIn = (values: string[]) => values.filter((v) => v.includes('LPA:1$'));

test.describe('W5 storage after a claim (T-60, T-61)', () => {
  // Property: after a full claim + install hand-off the session secret / sealed box are nowhere; localStorage holds
  // per-viewer conveniences only; the LPA is not in any URL, header, console line, or Cache Storage entry.
  test('claim → install: no key material, no sealed box, LPA only in IndexedDB', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      userAgent: IOS_17_4,
      viewport: { width: 390, height: 844 },
    });
    await distinctClient(context);
    const page = await context.newPage();
    const wire = tap(page);
    const key = await claimFreeBundle(page);
    await page.goto('/install');
    await expect(page.getByTestId('ios-universal-link')).toBeVisible();
    const dump = await dumpAll(page);
    const lpas = lpaIn(dump.idb);
    expect(lpas.length, 'exactly one opened LPA before install').toBe(1);
    const lpa = /LPA:1\$[^"\s]+/.exec(lpas[0] ?? '')?.[0] ?? '';
    expect(lpa).toMatch(/^LPA:1\$local\.test\$/);
    // localStorage: only the documented per-viewer keys
    for (const k of Object.keys(dump.local))
      expect(k).toMatch(/^recharge\.(lang|a2hs\.dismissed|sim\.seed|sponsor\.campaigns|proof)$/);
    expect(Object.keys(dump.session)).toEqual([]);
    const everything = [...Object.values(dump.local), ...dump.idb, ...dump.caches].join('\n');
    expect(everything).not.toMatch(/secret|secretKey|"sk"/i);
    for (const s of wire.sealed) {
      const box = JSON.parse(s) as Record<string, string>;
      for (const v of Object.values(box))
        if (typeof v === 'string' && v.length > 20) expect(everything).not.toContain(v);
    }
    expect(dump.caches.join('\n')).not.toContain('LPA:1$');
    // the LPA never leaves in a URL of ours, a header (Referer) or a POST body; never in the console
    expect(wire.urls.filter((u) => u.includes(encodeURIComponent(lpa)) || u.includes(lpa))).toEqual(
      [],
    );
    expect(wire.headers.filter((h) => h.includes('LPA:1') || h.includes('LPA%3A1'))).toEqual([]);
    expect(wire.bodies.filter((b) => b.includes('LPA:1'))).toEqual([]);
    expect(wire.console.filter((c) => /LPA:1|LPA%3A1|auditKey|PAYMENT-SIGNATURE/i.test(c))).toEqual(
      [],
    );
    // the universal link opens top-level with no referrer (and never as a same-origin redirector)
    const link = page.getByTestId('ios-universal-link');
    await expect(link).toHaveAttribute(
      'href',
      `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${encodeURIComponent(lpa)}`,
    );
    expect(await link.getAttribute('rel')).toContain('noreferrer');
    expect(key.length).toBeGreaterThan(8);
    await context.close();
  });

  // Property (T-76): once /me reports the eSIM installed (or active), the opened LPA is deleted from IndexedDB.
  // Regression for RT-W-01 (fixed; was: nothing in apps/web ever deleted `lpa:<key>`, so the LPA outlived the install).
  test('opened LPA is deleted once /me says installed', async ({ page }) => {
    const key = await claimFreeBundle(page);
    await page.route(`${API_URL}/me/**`, async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as Record<string, unknown>;
      if ('status' in body) body.status = 'active';
      await route.fulfill({ response: res, body: JSON.stringify(body) });
    });
    await page.goto('/install');
    await expect(page.getByTestId('status-pill')).toContainText('LTE');
    await page.goto(`/plan/${encodeURIComponent(key)}`);
    await page.waitForLoadState('networkidle');
    expect(lpaIn(await storedValues(page)), 'opened LPA still in IndexedDB after install').toEqual(
      [],
    );
  });

  // Property (T-76, THREAT-MODEL §8 "one LPA at a time"): a second plan on the device does not leave the first LPA behind.
  test("a second plan does not keep the first plan's LPA (one LPA at a time)", async ({ page }) => {
    await claimFreeBundle(page);
    const card = state().cards.at(-1);
    test.skip(!card, 'no seeded card');
    await page.goto(`/card/${card?.serial ?? ''}`);
    await page.getByTestId('card-pin').fill(card?.pin ?? '');
    await page.getByRole('button', { name: /Check/ }).click();
    await page.getByRole('button', { name: /Reveal PIN/ }).click();
    await page.getByTestId('card-redeem').click();
    await page.waitForURL(/\/plan\/.+/, { timeout: 30_000 });
    expect(lpaIn(await storedValues(page)).length, 'opened LPAs on the device').toBeLessThanOrEqual(
      1,
    );
  });
});

/** /install renders no install link, and no href on the page matches `forbidden`. */
async function expectNoInstallLink(page: Page, forbidden: RegExp) {
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('ios-universal-link')).toHaveCount(0);
  const hrefs = await page
    .locator('a[href]')
    .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  expect(hrefs.filter((h) => forbidden.test(h))).toEqual([]);
}

test.describe('W6 /install accepts nothing from the URL (T-62)', () => {
  test.use({ userAgent: IOS_17_4 });
  // Property: no link is ever built from a URL parameter or fragment; with no stored LPA nothing actionable renders.
  for (const q of [
    `?lpa=${encodeURIComponent('LPA:1$smdp.example$EVIL')}`,
    `?url=${encodeURIComponent('https://attacker.example')}`,
    `?carddata=${encodeURIComponent(LOCAL_LPA)}`,
    `#${LOCAL_LPA}`,
  ]) {
    test(`/install${q.slice(0, 18)}… renders no link`, async ({ page }) => {
      await page.goto(`/install${q}`);
      await expectNoInstallLink(page, /esimsetup|attacker|EVIL|carddata|LPA/i);
    });
  }

  // Property: a tampered IndexedDB value that fails LPA_PATTERN never becomes a link (scheme / markup / `?` injection).
  for (const bad of [
    'javascript:window.__xss=1',
    'LPA:1$<img src=x>$x',
    'LPA:1$smdp.example$ABC DEF',
    'LPA:1$smdp.example$ABC?x=1',
    'LPA:1$smdp.example$ABC&carddata=LPA:1$evil.example$X',
    'LPA:1$smdp.example$ABC#frag',
    'LPA:1$-evil.example$ABC',
    'intent://evil#Intent;scheme=http;end',
  ]) {
    test(`tampered stored LPA ${JSON.stringify(bad).slice(0, 30)} → no link`, async ({ page }) => {
      await page.goto('/offline');
      await page.evaluate(async (value) => {
        const db = await new Promise<IDBDatabase>((res, rej) => {
          const r = indexedDB.open('recharge', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('kv');
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error ?? new Error('indexeddb'));
        });
        await new Promise<void>((res) => {
          const tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').put('rt-key', 'currentKey');
          tx.objectStore('kv').put(value, 'lpa:rt-key');
          tx.oncomplete = () => res();
        });
      }, bad);
      await page.goto('/install');
      await expectNoInstallLink(page, /esimsetup|javascript:|evil/i);
    });
  }
});

test.describe('Android intent link is a constant (no LPA string reaches an intent: URL)', () => {
  test.use({ userAgent: ANDROID });
  // Property: the only intent: href is the fixed MANAGE_EMBEDDED_SUBSCRIPTIONS string, independent of the LPA.
  test('intent href is constant and carries no LPA', async ({ page }) => {
    await claimFreeBundle(page);
    await page.goto('/install');
    // the steps render once this device's LPA is read from IndexedDB (async): wait for the screen, not a race
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('copy-activation-code')).toBeVisible();
    const intents = await page
      .locator('a[href^="intent:"]')
      .evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(intents).toEqual([
      'intent:#Intent;action=android.telephony.euicc.action.MANAGE_EMBEDDED_SUBSCRIPTIONS;end',
    ]);
  });
});

test.describe('The plan pointer cannot be moved by a link (capability hygiene, T-73)', () => {
  test.use({ userAgent: IOS_17_4 });
  // Property: visiting a crafted /plan/<other key> link does not silently re-point this device's "current plan"
  // (which /install, /agent and the Add-data tab act on). Regression for RT-W-03 (fixed: the pointer only names a plan this device holds).
  test('a crafted /plan/<garbage> link does not hijack /install and the tabs', async ({ page }) => {
    await claimFreeBundle(page);
    await page.goto('/install');
    await expect(page.getByTestId('ios-universal-link')).toBeVisible();
    // one click on a link from a chat message
    await page.goto(`/plan/${encodeURIComponent('attacker-chosen-key')}`);
    await page.waitForLoadState('networkidle');
    await page.goto('/install');
    await page.waitForLoadState('networkidle');
    await expect(
      page.getByTestId('ios-universal-link'),
      'own LPA no longer reachable from /install',
    ).toBeVisible({ timeout: 5_000 });
  });
});
