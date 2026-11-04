/**
 * Product probes the builder's a11y.spec does not cover: axe in BOTH themes on every route INCLUDING error states,
 * 360 px on error states, touch targets ≥ 44 px (brief: 48), i18n (lang on Devanagari, untranslated English left in
 * hi/mr, raw key ids, Latin numerals), Lighthouse-style PWA installability (CDP) and LCP on `/` at 360 px under
 * mobile throttling.
 */
import AxeBuilder from '@axe-core/playwright';

import { claimFreeBundle, expect, expectNoHorizontalScroll, state, test } from '../../e2e/fixtures';
import en from '../../i18n/en.json' with { type: 'json' };

import type { Page } from '@playwright/test';

const ERROR_ROUTES = [
  '/plan/not-a-key',
  '/card/zzzzzzzz',
  '/card/deadbeef',
  '/sponsor/0x00',
  '/pay?key=not-a-key',
  '/receipts?key=not-a-key',
  '/this-route-does-not-exist',
];
const STATIC_ROUTES = [
  '/',
  '/verify',
  '/pay',
  '/install',
  '/gift',
  '/gift/claim',
  '/card',
  '/receipts',
  '/agent',
  '/sponsor',
  '/offline',
];

async function routesWithPlan(page: Page): Promise<string[]> {
  const key = await claimFreeBundle(page);
  const k = encodeURIComponent(key);
  return [
    ...STATIC_ROUTES,
    `/plan/${k}`,
    `/pay?key=${k}`,
    `/receipts?key=${k}`,
    `/card/${state().cards[0]?.serial ?? ''}`,
    ...ERROR_ROUTES,
  ];
}

async function settle(page: Page, route: string) {
  await page.goto(route);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(200);
}

test.describe('accessibility in both themes incl. error states', () => {
  for (const scheme of ['light', 'dark'] as const) {
    // Property: axe reports no serious/critical WCAG 2 A/AA violation on any route, in either theme.
    test(`axe serious/critical = 0 (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const problems: string[] = [];
      for (const route of await routesWithPlan(page)) {
        await settle(page, route);
        const r = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();
        for (const v of r.violations.filter(
          (x) => x.impact === 'serious' || x.impact === 'critical',
        ))
          problems.push(
            `${route}: ${v.id} ×${v.nodes.length} ${v.nodes[0]?.target.join(' ') ?? ''}`,
          );
      }
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }

  // Property: no horizontal scroll at 360 px on error states and the sponsor console too.
  test('360 px: no horizontal scroll on error states', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    for (const route of [...ERROR_ROUTES, '/sponsor', `/sponsor/${state().campaignId}`, '/ui']) {
      await settle(page, route);
      await expectNoHorizontalScroll(page);
    }
  });

  // Property (web.md §8: 48 px targets; WCAG 2.5.5 floor 44 px): every visible control is ≥ 44 × 44 CSS px.
  // FINDING RT-W-07 lists the offenders.
  // RT-FINDING
  test('touch targets ≥ 44 px on every consumer route_RTFINDING', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    const small: string[] = [];
    for (const route of await routesWithPlan(page)) {
      await settle(page, route);
      const found = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=radio], [role=button]',
          ),
        ]
          .filter((el) => {
            const s = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0;
          })
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              w: Math.round(r.width),
              h: Math.round(r.height),
              what: `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ')[0]}` : ''} "${(el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 24)}"`,
            };
          })
          .filter((x) => x.w < 44 || x.h < 44),
      );
      for (const f of found) small.push(`${route}: ${f.what} ${f.w}×${f.h}`);
    }
    expect([...new Set(small)], [...new Set(small)].join('\n')).toEqual([]);
  });
});

test.describe('i18n: Hindi / Marathi rendering', () => {
  const KEY_ID = new RegExp(
    `\\b(${[...new Set(Object.keys(en).map((k) => k.split('.')[0]))].join('|')})\\.[a-zA-Z0-9]+(\\.[a-zA-Z0-9]+)*\\b`,
  );

  async function audit(page: Page, lang: 'hi' | 'mr') {
    return page.evaluate(
      ({ lang, keyId }) => {
        const re = new RegExp(keyId);
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const wrongLang: string[] = [];
        const english: string[] = [];
        const rawIds: string[] = [];
        const devanagariDigits: string[] = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const text = (n.textContent ?? '').trim();
          const el = n.parentElement;
          if (
            !text ||
            !el ||
            el.closest(
              'script,style,[aria-hidden="true"],.lang-switch,[data-hash],.demo-wallet,.testnet-strip',
            )
          )
            continue;
          const tag = el.closest('[lang]')?.getAttribute('lang');
          if (/[ऀ-ॿ]/.test(text) && tag !== lang && tag !== 'hi' && tag !== 'mr')
            wrongLang.push(`${tag}: ${text.slice(0, 40)}`);
          if (/[०-९]/.test(text)) devanagariDigits.push(text.slice(0, 40));
          if (re.test(text)) rawIds.push(text.slice(0, 40));
          // two or more English words with no Devanagari: a string the locale left untranslated
          if (
            !/[ऀ-ॿ]/.test(text) &&
            /\b[A-Za-z]{2,}\b[^A-Za-z]+\b[a-z]{2,}\b/.test(text) &&
            !/^(Recharge|USDC|eSIM|World App|MB|GB|LTE)/.test(text)
          )
            english.push(text.slice(0, 48));
        }
        return { wrongLang, english, rawIds, devanagariDigits };
      },
      { lang, keyId: KEY_ID.source },
    );
  }

  for (const lang of ['hi', 'mr'] as const) {
    // Property: no raw key id ("plan.install") ever renders; numerals stay Latin in hi/mr.
    test(`${lang}: no raw key ids, Latin numerals`, async ({ page }) => {
      const routes = await routesWithPlan(page);
      await page.goto('/');
      await page.getByRole('button', { name: lang === 'hi' ? 'हिं' : 'मरा' }).click();
      const issues: string[] = [];
      for (const route of routes) {
        await settle(page, route);
        const a = await audit(page, lang);
        issues.push(
          ...a.rawIds.map((x) => `${route} raw id ${x}`),
          ...a.devanagariDigits.map((x) => `${route} Devanagari digits ${x}`),
        );
      }
      expect(issues, issues.join('\n')).toEqual([]);
    });

    // Property (web.md §7, design-references §6): every Devanagari string sits under lang="hi"|"mr" so fonts.css
    // applies leading 1.6 and screen readers switch voice. FINDING RT-W-08: buttons, field labels, review rows,
    // receipts and the pre-flight line render Devanagari under the page's lang="en".
    // RT-FINDING
    test(`${lang}: Devanagari text carries its lang attribute_RTFINDING`, async ({ page }) => {
      const routes = await routesWithPlan(page);
      await page.goto('/');
      await page.getByRole('button', { name: lang === 'hi' ? 'हिं' : 'मरा' }).click();
      const issues: string[] = [];
      for (const route of routes) {
        await settle(page, route);
        issues.push(
          ...(await audit(page, lang)).wrongLang.map((x) => `${route.slice(0, 40)} ${x}`),
        );
      }
      expect([...new Set(issues)], [...new Set(issues)].join('\n')).toEqual([]);
    });

    // Property: a consumer screen in hi/mr carries no untranslated English sentence fragments
    // ("Expires in", "Claim by", "Mumbai · 7 days", "Network fee", sponsor-console excepted). FINDING RT-W-08.
    // RT-FINDING
    test(`${lang}: no untranslated English on consumer screens_RTFINDING`, async ({ page }) => {
      const routes = (await routesWithPlan(page)).filter(
        (r) => !r.startsWith('/sponsor') && r !== '/this-route-does-not-exist',
      );
      await page.goto('/');
      await page.getByRole('button', { name: lang === 'hi' ? 'हिं' : 'मरा' }).click();
      const left: string[] = [];
      for (const route of routes) {
        await settle(page, route);
        left.push(...(await audit(page, lang)).english.map((x) => `${route}: ${x}`));
      }
      expect([...new Set(left)], [...new Set(left)].join('\n')).toEqual([]);
    });
  }
});

test.describe('PWA installability and performance', () => {
  test.use({ serviceWorkers: 'allow' });
  // Property (web.md §5, DoD): Chromium reports no installability error (manifest, icons, SW, start_url).
  test('installable: CDP Page.getInstallabilityErrors is empty', async ({ page, context }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await page.waitForTimeout(1_000);
    const cdp = await context.newCDPSession(page);
    const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as {
      installabilityErrors: { errorId: string }[];
    };
    expect(installabilityErrors.map((e) => e.errorId)).toEqual([]);
    const manifest = (await (await page.request.get('/manifest.webmanifest')).json()) as {
      icons: { sizes: string; purpose?: string }[];
      start_url: string;
      scope: string;
      display: string;
    };
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(
      true,
    );
    for (const icon of manifest.icons as unknown as { src: string }[])
      expect((await page.request.get(icon.src)).status()).toBe(200);
  });

  // Property (Lighthouse "good"): LCP on `/` at 360 px under mobile throttling (150 ms RTT, 1.6 Mbps, CPU ×4) ≤ 2.5 s.
  test('LCP on / at 360 px under mobile throttling ≤ 2500 ms', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 360, height: 780 },
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    let bytes = 0;
    page.on('response', async (r) => {
      bytes += Number(r.headers()['content-length'] ?? 0);
    });
    await page.goto('/', { waitUntil: 'load', timeout: 60_000 });
    const lcp = await page.evaluate(
      () =>
        new Promise<{ t: number; el: string }>((resolve) => {
          new PerformanceObserver((list) => {
            const last = list.getEntries().at(-1) as PerformanceEntry & { element?: Element };
            resolve({
              t: Math.round(last.startTime),
              el: last.element?.className?.toString() ?? last.element?.tagName ?? '',
            });
          }).observe({ type: 'largest-contentful-paint', buffered: true });
          setTimeout(() => resolve({ t: -1, el: 'none' }), 5_000);
        }),
    );
    console.log(
      `RT perf: LCP ${lcp.t} ms on ${lcp.el}; ${Math.round(bytes / 1024)} KiB declared transfer`,
    );
    expect(lcp.t).toBeGreaterThan(0);
    expect(lcp.t).toBeLessThanOrEqual(2_500);
    await context.close();
  });
});
