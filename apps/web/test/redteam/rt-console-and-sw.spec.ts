/**
 * W11 (sponsor UI, audit key, slide-to-confirm), the service worker (W5.2, T-61), the print sheet (W9, T-64) and the
 * MODE=local demo plumbing (/api/demo-wallet, T-63/T-85) — against the real local stack.
 */
import { createServer, type Server } from 'node:http';

import { expect, test } from '@playwright/test';
import { mnemonicToAccount } from 'viem/accounts';

import { reader, seedCampaign } from './rt-seed';
import { ANVIL_MNEMONIC, API_URL, PRINT_TOKEN } from '../../e2e/env';
import { claimFreeBundle, distinctClient, state } from '../../e2e/fixtures';

const EVIL = 'http://127.0.0.1:9999';

test.describe('W11 sponsor console', () => {
  // Property: the Recharge-Sponsor bearer and the audit key never land in web storage, the URL or the console.
  test('bearer and audit key are memory-only', async ({ page }) => {
    const id = await seedCampaign('RT bearer check');
    const consoleLines: string[] = [];
    page.on('console', (m) => consoleLines.push(m.text()));
    await page.goto(`/sponsor/${id}`);
    await expect(page.getByTestId('sponsor-claims')).toBeVisible({ timeout: 30_000 });
    const stored = await page.evaluate(() =>
      JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } }),
    );
    expect(stored).not.toMatch(/signature|issuedAt|Recharge-Sponsor|auditKey|0x[0-9a-f]{64}/i);
    expect(page.url()).not.toMatch(/auth|signature|audit/i);
    expect(consoleLines.join('\n')).not.toMatch(/Recharge-Sponsor|auditKey|signature/i);
  });

  // Property: when the API refuses the login (401), the UI shows no table, no export and no Pause/Refund control.
  test('a refused login renders no data and no write control', async ({ page }) => {
    const id = await seedCampaign('RT refused login');
    await page.route(`${API_URL}/sponsor/**`, (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'unauthorized', message: 'bad login', requestId: 'rt' }),
      }),
    );
    await page.goto(`/sponsor/${id}`);
    await expect(page.locator('.sponsor-view .note')).toContainText(/unauthorized/);
    await expect(page.getByTestId('slide-to-confirm')).toHaveCount(0);
    await expect(page.getByTestId('claims-table')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Export claims CSV/ })).toHaveCount(0);
  });

  // Property (W11.4, design-foundations §2.10): Pause is a SLIDE — one click near the end of the track does not
  // send the pause transaction (pointer-up below 100 resets it).
  test('a single click at the end of the slider does not pause the campaign', async ({ page }) => {
    const id = await seedCampaign('RT slide check');
    await page.goto(`/sponsor/${id}`);
    const slider = page.getByTestId('slide-to-confirm');
    await expect(slider).toBeEnabled({ timeout: 30_000 });
    const box = await slider.boundingBox();
    if (!box) throw new Error('no slider');
    await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
    await page.waitForTimeout(4_000);
    await expect(
      page.locator('.pill[data-state="paused"]'),
      'paused by a single click',
    ).toHaveCount(0);
  });

  // Property (W11.4): focus + one keystroke (End) is not a slide either. Regression for RT-W-04 (fixed: a gesture of ≥ 3 moves over ≥ 300 ms, fired on release).
  test('one End keystroke on the focused slider does not pause the campaign', async ({ page }) => {
    const id = await seedCampaign('RT slide key');
    await page.goto(`/sponsor/${id}`);
    const slider = page.getByTestId('slide-to-confirm');
    await expect(slider).toBeEnabled({ timeout: 30_000 });
    await slider.focus();
    await page.keyboard.press('End');
    await page.waitForTimeout(4_000);
    await expect(page.locator('.pill[data-state="paused"]'), 'paused by one keystroke').toHaveCount(
      0,
    );
  });
});

test.describe('W5.2 service worker (T-61)', () => {
  test.use({ serviceWorkers: 'allow' });
  // Property: Cache Storage holds the app shell, /_next/static and icons only — never an API response, never a
  // /plan/<key> document, never an LPA or entitlement key — after a full claim and every sensitive route.
  test('caches hold the shell only after a claim and an install visit', async ({
    page,
    context,
  }) => {
    await distinctClient(context);
    await page.goto('/');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    const key = await claimFreeBundle(page);
    for (const route of [
      `/plan/${encodeURIComponent(key)}`,
      '/install',
      '/receipts',
      '/agent',
      '/gift',
      '/card',
    ]) {
      await page.goto(route);
      await page.waitForLoadState('networkidle').catch(() => undefined);
    }
    const entries = await page.evaluate(async () => {
      const out: { url: string; body: string }[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const req of await cache.keys()) {
          const res = await cache.match(req);
          out.push({ url: req.url, body: (await res?.text()) ?? '' });
        }
      }
      return out;
    });
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      const path = new URL(e.url).pathname;
      expect(path, e.url).toMatch(
        /^\/($|offline$|plan$|manifest\.webmanifest$|icons\/|_next\/static\/)/,
      );
      expect(e.url.startsWith(API_URL), e.url).toBe(false);
      expect(e.body, e.url).not.toContain('LPA:1$');
      expect(e.body, e.url).not.toContain(key);
    }
  });

  // Property (web.md §5): offline, /plan/<key> shows the IndexedDB snapshot ("as of HH:MM") — no LPA, no replayed
  // API response — instead of a blank or a different route.
  test('offline /plan/<key> renders the snapshot, not an API replay', async ({ page, context }) => {
    await distinctClient(context);
    await page.goto('/');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    const key = await claimFreeBundle(page);
    await page.goto(`/plan/${encodeURIComponent(key)}`);
    await page.waitForLoadState('networkidle');
    await context.setOffline(true);
    await page.reload().catch(() => undefined);
    await page.waitForTimeout(2_000);
    const text = await page.locator('body').innerText();
    expect(text).not.toContain('LPA:1$');
    expect(text, 'offline plan view (a blank shell was RT-W-06)').toMatch(/MB/);
    await context.setOffline(false);
  });
});

test.describe('W9 /print/cards (T-64)', () => {
  const pins = () => state().cards.map((c) => c.pin);
  // Property: every wrong-token / bypass variant is a bare 404 with noindex and no PIN, serial or route hint.
  const variants = [
    '/print/cards',
    '/print/cards?token=',
    '/print/cards?token=wrong',
    `/print/cards?token=${PRINT_TOKEN.slice(0, -1)}`,
    `/print/cards?token=${PRINT_TOKEN.toUpperCase()}`,
    `/print/cards?token=${PRINT_TOKEN}%20`,
    `/print/cards?token=%20${PRINT_TOKEN}`,
    `/print/cards?token=wrong&token=${PRINT_TOKEN}`,
    `/print/cards?TOKEN=${PRINT_TOKEN}`,
    '/print/cards/',
    '/print/cards?_rsc=1',
    '/print/cards/x',
    '/%70rint/cards',
    '/print/%63ards',
  ];
  for (const v of variants) {
    test(`404: ${v}`, async ({ request }) => {
      const res = await request.get(v, { maxRedirects: 0 });
      expect([404, 308], `${v} → ${res.status()}`).toContain(res.status());
      if (res.status() === 308) return;
      const body = await res.text();
      for (const pin of pins()) expect(body).not.toContain(pin);
      expect(res.headers()['x-robots-tag'] ?? '').toContain('noindex');
    });
  }

  // Property: the CVE-2025-29927 middleware-skip header does not bypass the token check (proxy.ts + page re-check).
  test('x-middleware-subrequest does not skip the token check', async ({ request }) => {
    for (const h of [
      'proxy',
      'middleware',
      'src/middleware',
      'middleware:middleware:middleware:middleware:middleware',
      'proxy:proxy:proxy:proxy:proxy',
    ]) {
      const res = await request.get('/print/cards', { headers: { 'x-middleware-subrequest': h } });
      expect(res.status(), h).toBe(404);
      const body = await res.text();
      for (const pin of pins()) expect(body).not.toContain(pin);
    }
  });

  // Property: with the right token the sheet is no-store, no-referrer, noindex and makes no third-party request.
  test('right token: no-store, no-referrer, noindex, first-party requests only', async ({
    page,
    baseURL,
  }) => {
    const external: string[] = [];
    const own = new URL(baseURL ?? 'http://127.0.0.1:3000').host;
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.host === own || u.protocol.startsWith('data')) return;
      // a Google Fonts fetch is allowed (W9.2) when it carries no Referer of ours (gstatic sees googleapis' CSS as referer)
      const referer = r.headers().referer ?? '';
      if (
        /^fonts\.(googleapis|gstatic)\.com$/.test(u.host) &&
        (!referer || /^https:\/\/fonts\.googleapis\.com\/?$/.test(referer))
      )
        return;
      external.push(`${r.url()} referer=${r.headers().referer ?? ''}`);
    });
    const res = await page.goto(`/print/cards?token=${PRINT_TOKEN}`);
    expect(res?.status()).toBe(200);
    const h = res?.headers() ?? {};
    expect(h['cache-control']).toContain('no-store');
    expect(h['referrer-policy']).toBe('no-referrer');
    expect(h['x-robots-tag']).toContain('noindex');
    expect(external.filter((u) => u.includes('token='))).toEqual([]);
    expect(external).toEqual([]);
  });

  // Property: the print token never appears in the HTML of another route or in any client chunk.
  test('PRINT_TOKEN is in no other route and no client chunk', async ({ request }) => {
    for (const route of ['/', '/verify', '/sponsor', '/card', '/offline', '/ui', '/ui/print']) {
      const body = await (await request.get(route)).text();
      expect(body, route).not.toContain(PRINT_TOKEN);
    }
  });
});

test.describe('MODE=local demo plumbing (T-63, T-85)', () => {
  // Property: the demo wallet's EIP-1193 route signs only for the PWA itself — a cross-site text/plain POST (any
  // page the demo laptop opens) must not make Anvil #3 send a transaction. Regression for RT-W-05 (fixed: same-origin + JSON only, method allow-list).
  test('a cross-origin no-cors POST cannot drive /api/demo-wallet', async ({ page, baseURL }) => {
    const sponsor = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: 3 }).address;
    const before = await reader.getTransactionCount({ address: sponsor, blockTag: 'pending' });
    // a real loopback server (a route-fulfilled page counts as "public" for Chromium's local-network checks)
    const server: Server = createServer((_, res) =>
      res.writeHead(200, { 'content-type': 'text/html' }).end('<p>cat pictures</p>'),
    );
    await new Promise<void>((r) => server.listen(9999, '127.0.0.1', r));
    await page.goto(`${EVIL}/evil.html`);
    await page.evaluate(
      async ({ target, to }) => {
        // eslint-disable-next-line no-restricted-syntax -- the attack IS a raw browser fetch (runs in the page)
        await fetch(`${target}/api/demo-wallet`, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'content-type': 'text/plain' },
          body: JSON.stringify({
            role: 'sponsor',
            method: 'eth_sendTransaction',
            params: [{ to, value: '0x1' }],
          }),
        });
      },
      { target: baseURL ?? '', to: sponsor },
    );
    await page.waitForTimeout(2_500);
    server.close();
    const after = await reader.getTransactionCount({ address: sponsor, blockTag: 'pending' });
    expect(after, 'Anvil #3 nonce moved by a cross-site request').toBe(before);
  });

  // Property: the demo wallet is not a general Anvil RPC proxy (anvil_* / evm_* cheat methods are refused).
  test('/api/demo-wallet refuses anvil_/evm_ cheat methods', async ({ request }) => {
    const res = await request.post('/api/demo-wallet', {
      headers: { 'content-type': 'text/plain' },
      data: JSON.stringify({ role: 'human', method: 'anvil_nodeInfo', params: [] }),
    });
    expect(res.status()).not.toBe(200);
  });

  // Property: GET /api/demo-wallet does not leak key material (roles only, never a key or the mnemonic).
  test('demo wallet GET exposes no key material', async ({ request }) => {
    const body = await (await request.get('/api/demo-wallet')).text();
    expect(body).not.toMatch(/0x[0-9a-f]{64}|test test|mnemonic/i);
  });
});

test.describe('W8 link-preview bots and prefetch (T-47)', () => {
  // Property: GET /card/<serial> by preview bots, prefetch and reload never redeems the card.
  test('bots and prefetch leave the card open', async ({ request, page }) => {
    const card = state().cards[0];
    test.skip(!card, 'no seeded card');
    const serial = card?.serial ?? '';
    for (const ua of [
      'TelegramBot (like TwitterBot)',
      'WhatsApp/2.23',
      'facebookexternalhit/1.1',
      'Slackbot-LinkExpanding 1.0',
      'Discordbot/2.0',
      'Twitterbot/1.0',
    ]) {
      await request.get(`/card/${serial}`, { headers: { 'user-agent': ua } });
      await request.get(`/card/${serial}`, {
        headers: { 'sec-purpose': 'prefetch', purpose: 'prefetch' },
      });
    }
    const posts: string[] = [];
    page.on('request', (r) => r.method() === 'POST' && posts.push(r.url()));
    await page.goto(`/card/${serial}`);
    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(posts.filter((u) => u.includes('/card/redeem'))).toEqual([]);
    const preview = (await (await request.get(`${API_URL}/card/${serial}`)).json()) as {
      state: string;
    };
    expect(preview.state).toBe('open');
  });
});
