/**
 * W1 — XSS through every rendered string (T-58, T-70). Sinks are reached three ways: (1) seeded through the real API
 * (a sponsor campaign whose name is the payload, registered exactly like the console does), (2) URL parameters of
 * every route that reads one, (3) a hostile/compromised API answer (page.route rewrites the JSON body — this is the
 * "the API echoes attacker text" case: ENS names, sponsor names, reseller errors). After each page:
 * window.__xss is undefined, no dialog fired, and the payload is present as TEXT where the field shows it.
 */
import { ASCII_PAYLOADS, PAYLOADS } from './rt-payloads';
import { seedCampaign } from './rt-seed';
import { API_URL } from '../../e2e/env';
import { claimFreeBundle, expect, test } from '../../e2e/fixtures';

import type { Page } from '@playwright/test';

async function armed(page: Page): Promise<{ dialogs: string[] }> {
  const seen = { dialogs: [] as string[] };
  page.on('dialog', (d) => {
    seen.dialogs.push(d.message());
    void d.dismiss();
  });
  return seen;
}

async function expectNoXss(page: Page, seen: { dialogs: string[] }, where: string) {
  await page.waitForTimeout(300);
  expect(
    await page.evaluate(() => (window as { __xss?: unknown }).__xss),
    `${where}: __xss`,
  ).toBeUndefined();
  expect(seen.dialogs, `${where}: dialogs`).toEqual([]);
  // no attacker-controlled element or javascript: URL made it into the DOM
  const injected = await page.evaluate(() => ({
    onerror: document.querySelectorAll('[onerror],[onload]').length,
    jsHref: [...document.querySelectorAll('a[href],iframe[src],form[action]')].filter((el) =>
      /^\s*javascript:/i.test(
        el.getAttribute('href') ?? el.getAttribute('src') ?? el.getAttribute('action') ?? '',
      ),
    ).length,
  }));
  expect(injected, `${where}: injected attributes`).toEqual({ onerror: 0, jsHref: 0 });
}

/** Rewrites one JSON field of every matching API response (the hostile-API sink). */
async function poison(page: Page, glob: string, edit: (body: Record<string, unknown>) => void) {
  await page.route(`${API_URL}${glob}`, async (route) => {
    const res = await route.fetch();
    const text = await res.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return route.fulfill({ response: res, body: text });
    }
    edit(body);
    await route.fulfill({ response: res, body: JSON.stringify(body) });
  });
}

test.describe('W1 XSS — seeded through the real API', () => {
  // Property: a campaign name accepted by safeTextSchema renders as text on the sponsor console.
  test('sponsor console renders an <img onerror> campaign name as text', async ({ page }) => {
    const payload = ASCII_PAYLOADS[0] ?? '';
    const id = await seedCampaign(payload);
    const seen = await armed(page);
    await page.goto(`/sponsor/${id}`);
    await expect(page.getByTestId('sponsor-claims')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.sponsor-hero__name')).toContainText(payload);
    await expectNoXss(page, seen, '/sponsor/[id]');
  });
});

test.describe('W1 XSS — URL parameters', () => {
  const routes = (p: string) => {
    const e = encodeURIComponent(p);
    return [
      `/plan/${e}`,
      `/pay?key=${e}`,
      `/pay?mb=${e}`,
      `/receipts?key=${e}`,
      `/card/${e}`,
      `/sponsor/${e}`,
      `/gift/claim?id=0x${'ab'.repeat(32)}&name=${e}`,
      `/install?lpa=${e}`,
      `/install#${e}`,
      `/print/cards?token=${e}`,
      `/ui/print?count=${e}&side=${e}`,
    ];
  };
  for (const [i, payload] of PAYLOADS.entries()) {
    // Property: no route turns a URL parameter into markup or a javascript: link.
    test(`payload #${i} through every URL parameter`, async ({ page }) => {
      const seen = await armed(page);
      for (const route of routes(payload)) {
        await page.goto(route);
        await page.waitForLoadState('networkidle').catch(() => undefined);
        await expectNoXss(page, seen, route);
      }
    });
  }
  // Property: /gift/claim shows the name parameter literally (text, not markup).
  test('/gift/claim?name= renders the payload literally', async ({ page }) => {
    const payload = '<img src=x onerror="window.__xss=1">';
    const seen = await armed(page);
    await page.goto(`/gift/claim?id=0x${'ab'.repeat(32)}&name=${encodeURIComponent(payload)}`);
    await expect(page.getByTestId('claim-by-signature')).toContainText(payload);
    await expectNoXss(page, seen, '/gift/claim');
  });
});

test.describe('W1 XSS — a hostile API answer', () => {
  for (const payload of PAYLOADS.slice(0, 5)) {
    // Property: the sponsor name from /plans (landing coupon, verify sheet) is text.
    test(`/plans campaign.name = ${JSON.stringify(payload).slice(0, 24)}`, async ({ page }) => {
      await poison(page, '/plans', (b) => {
        const c = b.campaign as Record<string, unknown> | null;
        if (c) c.name = payload;
      });
      const seen = await armed(page);
      await page.goto('/');
      await expect(page.locator('#landing-coupon')).toContainText(payload.slice(0, 12));
      await expectNoXss(page, seen, '/');
      await page.goto('/verify');
      await expectNoXss(page, seen, '/verify');
    });
  }

  // Property: /me sponsorName, arkivKey and the agent receipt uaid render as text on /plan, /receipts, /agent.
  test('/me and receipts strings are text on /plan, /receipts, /agent', async ({ page }) => {
    const key = await claimFreeBundle(page);
    const payload = PAYLOADS[0];
    await poison(page, '/me/**', (b) => {
      if ('sponsorName' in b || 'entitlementKey' in b) b.sponsorName = payload;
      if (Array.isArray(b.receipts))
        for (const r of b.receipts as Record<string, unknown>[]) {
          r.uaid = payload;
          r.kind = 'agent-topup';
        }
    });
    const seen = await armed(page);
    for (const route of [
      `/plan/${encodeURIComponent(key)}`,
      `/receipts?key=${encodeURIComponent(key)}`,
      '/agent',
    ]) {
      await page.goto(route);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await expectNoXss(page, seen, route);
    }
  });

  // Property: card preview sponsorName and API error messages are text on /card/[serial].
  test('/card/[serial] sponsorName and error message are text', async ({ page }) => {
    const seen = await armed(page);
    await page.route(`${API_URL}/card/*`, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
              serial: 'deadbeef',
              state: 'open',
              mb: 300,
              sponsorName: PAYLOADS[1],
              claimBy: Date.now() + 86_400_000,
            }),
          })
        : route.continue(),
    );
    await page.goto('/card/deadbeef');
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await expectNoXss(page, seen, '/card/deadbeef');
  });

  // Property: the ENS name typed into /gift is echoed as text in the resolve line and the review sheet.
  test('/gift echoes a hostile ENS name as text', async ({ page }) => {
    const seen = await armed(page);
    await page.goto('/gift');
    await page.getByTestId('gift-name').fill('<img src=x onerror=window.__xss=1>.eth');
    await page.waitForTimeout(800);
    await expectNoXss(page, seen, '/gift');
  });
});

test.describe('W1.4 CSP as the backstop if an injection ever lands', () => {
  // Property (wave3-web-ops.md W1.4): even with markup injected into the DOM, script does not run.
  // FINDING RT-W-02: script-src carries 'unsafe-inline' (documented in next.config.ts), so an inline event
  // handler executes — the CSP is no backstop for the IndexedDB-held LPA (T-76 names CSP as its primary control).
  // RT-FINDING
  test('injected inline handler does not execute (CSP backstop)_RTFINDING', async ({ page }) => {
    await page.goto('/offline');
    await page.evaluate(() => {
      document.body.insertAdjacentHTML('beforeend', '<img src="data:," onerror="window.__xss=1">');
    });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as { __xss?: unknown }).__xss)).toBeUndefined();
  });
});
