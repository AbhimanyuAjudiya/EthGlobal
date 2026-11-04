#!/usr/bin/env node
/**
 * Headless screen recordings of the real PWA (apps/web) running against the local stack (Anvil + API + seed):
 * every RENDERED look-alike in the videos is replaced by one of these. Playwright at 360 × 780 CSS px, device scale 3
 * (recorded at 1080 × 2340 device pixels, see screencast()), isMobile + hasTouch, an iPhone user agent, light and dark. Nothing is staged: every click goes
 * through the product's own code path (simulated World ID and the demo wallet are what MODE=local ships, and they
 * say so on screen), and every hash/key/PIN on screen is a local-stack value — the compositions label those frames
 * "SEED DATA · not a real record" until the Saturday testnet values replace them (src/seed/saturday.json).
 *
 *   bash scripts/e2e-local.sh --keep &                      # Anvil :8546, API :8788, seed
 *   (cd apps/web && bash e2e/serve.sh) &                    # the production build on :3000 (demo wallet on)
 *   node apps/video/scripts/capture-screens.mjs             # → apps/video/footage/screen/<clip>-<theme>.webm
 *   node apps/video/scripts/capture-screens.mjs --only plan,pay --themes light
 *   bash apps/video/scripts/conform-screens.sh              # webm → mp4 (CFR 30) + footage/index.json
 *
 * Env: WEB_URL (default http://127.0.0.1:3000), API_URL (default http://127.0.0.1:8788),
 * CHROME (default /opt/pw-browsers/chromium-1243/chrome-linux64/chrome), CARDS_FILE (default .e2e/cards.json).
 * Playwright is resolved from apps/web (its devDependency); apps/video adds no dependency for this.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
const OUT = join(HERE, '../footage/screen');
const TMP = join(OUT, '.tmp');
const { chromium } = createRequire(join(ROOT, 'apps/web/package.json'))('@playwright/test');

const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:3000';
const API = process.env.API_URL ?? 'http://127.0.0.1:8788';
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';

const { values: flags } = parseArgs({
  options: {
    only: { type: 'string', default: '' },
    themes: { type: 'string', default: 'light,dark' },
  },
});
const only = new Set(flags.only.split(',').filter(Boolean));
const themes = flags.themes.split(',').filter(Boolean);

const VIEWPORT = { width: 360, height: 780 };
const SCALE = 3;
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

const hold = (page, ms) => page.waitForTimeout(ms);
let ip = 0;
const SCALES = new WeakMap();

/** One browser profile = one simulated human (VerifySheet keeps the seed per profile). */
async function newContext(browser, theme, { ua = IPHONE, lang, size = VIEWPORT, mobile = true } = {}) {
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: mobile ? SCALE : 1,
    isMobile: mobile,
    hasTouch: mobile,
    userAgent: ua,
    colorScheme: theme,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    serviceWorkers: 'block',
  });
  SCALES.set(context, mobile ? SCALE : 1);
  // The API trusts X-Forwarded-For locally: one documentation-range address per profile keeps the per-IP
  // limits (5 claims/min) from coupling the captures. Nothing else is altered.
  ip += 1;
  const addr = `198.18.${100 + (ip % 100)}.${(ip % 250) + 1}`;
  await context.route(`${API}/**`, (route) =>
    route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': addr } }),
  );
  // Chrome's screencast emits a frame only when the compositor paints, and drops frames while an ack is in
  // flight, so a state that paints once (the odometer's last digit) could be lost. A 1 × 1 px element at 1 %
  // opacity in the corner repaints every animation frame: invisible, and the final state is always recorded.
  await context.addInitScript(() => {
    const start = () => {
      const dot = document.createElement('div');
      dot.setAttribute('aria-hidden', 'true');
      dot.style.cssText =
        'position:fixed;left:0;bottom:0;width:1px;height:1px;pointer-events:none;z-index:2147483647;background:gray;opacity:0.01';
      document.documentElement.appendChild(dot);
      let flip = false;
      const tick = () => {
        flip = !flip;
        dot.style.opacity = flip ? '0.011' : '0.01';
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  });
  if (lang) {
    await context.addInitScript((l) => {
      try {
        localStorage.setItem('recharge.lang', l);
      } catch {
        // storage blocked: the page stays in English
      }
    }, lang);
  }
  return context;
}

const results = [];

/**
 * The recording itself. Playwright's `recordVideo` encodes the CSS-pixel viewport (360 px wide even at device scale
 * 3), so the frames come from the same source it uses, Chrome's screencast, asked for device pixels instead:
 * 1080 × 2340 JPEG frames with their own timestamps, written as a variable-frame-rate VP9 webm (conform-screens.sh
 * makes it CFR 30). A frame is only emitted when the page paints, so each frame is held until the next one.
 */
async function screencast(page, clip, theme) {
  const vp = page.viewportSize() ?? VIEWPORT;
  const scale = SCALES.get(page.context()) ?? SCALE;
  const width = Math.round(vp.width * scale);
  const height = Math.round(vp.height * scale);
  const dir = join(TMP, `${clip}-${theme}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const frames = [];
  const cdp = await page.context().newCDPSession(page);
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = join(dir, `${String(frames.length).padStart(6, '0')}.jpg`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, t: metadata.timestamp ?? Date.now() / 1000 });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 95,
    maxWidth: width,
    maxHeight: height,
    everyNthFrame: 1,
  });
  return {
    async stop(out) {
      const end = Date.now() / 1000;
      await cdp.send('Page.stopScreencast').catch(() => undefined);
      await cdp.detach().catch(() => undefined);
      if (!out || frames.length === 0) return rmSync(dir, { recursive: true, force: true });
      const list = frames.map((f, i) => {
        const next = frames[i + 1]?.t ?? end;
        return `file '${f.file}'\nduration ${Math.max(0.001, next - f.t).toFixed(4)}`;
      });
      list.push(`file '${frames[frames.length - 1].file}'`);
      writeFileSync(join(dir, 'list.txt'), `${list.join('\n')}\n`);
      execFileSync('ffmpeg', [
        ...['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0'],
        ...['-i', join(dir, 'list.txt'), '-vf', `scale=${width}:${height}:flags=lanczos,format=yuv420p`],
        ...['-fps_mode', 'vfr', '-c:v', 'libvpx-vp9', '-crf', '20', '-b:v', '0', '-row-mt', '1'],
        ...['-deadline', 'good', '-cpu-used', '5', out],
      ]);
      rmSync(dir, { recursive: true, force: true });
      return end - frames[0].t;
    },
  };
}

/** Records `fn` on a fresh page of `context` into footage/screen/<clip>-<theme>.webm (or discards it). */
async function rec(context, clip, theme, fn, { keep = true } = {}) {
  const wanted = keep && (only.size === 0 || only.has(clip));
  const page = await context.newPage();
  const cast = wanted ? await screencast(page, clip, theme) : null;
  let value;
  try {
    value = await fn(page);
    // a still tail on the last state, so an edit can hold it without freezing a frame
    if (cast) await hold(page, 3000);
  } finally {
    const file = join(OUT, `${clip}-${theme}.webm`);
    const seconds = await cast?.stop(file);
    await page.close();
    if (cast && typeof seconds === 'number') {
      results.push({ clip, theme, file: `screen/${clip}-${theme}.webm`, seconds });
      console.log(`capture  ${clip}-${theme}.webm  ${seconds.toFixed(1)} s`);
    }
  }
  return value;
}

async function smoothScroll(page, top, ms = 900) {
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), top);
  await hold(page, ms);
}

async function scrollTo(page, locator, ms = 900) {
  const y = await locator.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  await smoothScroll(page, Math.max(0, y - 120), ms);
}

/** `/` → /verify → simulated World ID → /plan/<key>; returns the key. */
async function claim(page) {
  await page.goto(`${WEB}/verify`);
  const button = page.getByRole('button', { name: 'Simulated World ID' });
  await button.waitFor();
  await button.tap();
  await page.waitForURL(/\/plan\/.+/, { timeout: 30_000 });
  await page.getByTestId('issuing-arkiv').and(page.locator('[data-done="true"]')).waitFor();
  return decodeURIComponent(new URL(page.url()).pathname.replace(/^\/plan\//, ''));
}

async function slowType(locator, text) {
  await locator.tap();
  await locator.pressSequentially(text, { delay: 140 });
}

async function captureTheme(browser, theme) {
  const human = await newContext(browser, theme);

  // `/` — the human path: the live coupon, both paths, tap "Prove I'm human" → the /verify sheet.
  await rec(human, 'landing', theme, async (page) => {
    await page.goto(WEB);
    await page.locator('#landing-coupon .coupon__status').waitFor();
    await hold(page, 3200);
    await page.getByRole('link', { name: /Prove I.m human/ }).tap();
    await page.waitForURL(/\/verify$/);
    await page.getByRole('button', { name: 'Simulated World ID' }).waitFor();
    await hold(page, 2200);
  });
  // `/` — the pay path: "I'll pay · $0.40 per 100 MB" → the 402 Review sheet.
  await rec(human, 'landing-pay', theme, async (page) => {
    await page.goto(WEB);
    await page.locator('#landing-coupon .coupon__status').waitFor();
    await hold(page, 2200);
    await page.getByRole('link', { name: /I.ll pay/ }).tap();
    await page.waitForURL(/\/pay$/);
    await page.locator('.onchain-action').waitFor();
    await hold(page, 3200);
  });
  // `/verify` → Checking → the bundle issued: IssuingRows, odometer once, the lock-screen line.
  const key = await rec(human, 'verify', theme, async (page) => {
    await page.goto(`${WEB}/verify`);
    const button = page.getByRole('button', { name: 'Simulated World ID' });
    await button.waitFor();
    await hold(page, 2600);
    await button.tap();
    await page.waitForURL(/\/plan\/.+/, { timeout: 30_000 });
    await page.getByTestId('issuing-arkiv').and(page.locator('[data-done="true"]')).waitFor();
    await hold(page, 3500);
    return decodeURIComponent(new URL(page.url()).pathname.replace(/^\/plan\//, ''));
  });
  const planUrl = `${WEB}/plan/${encodeURIComponent(key)}`;
  // `/plan/[key]` — the meter, "usage as of", Expires in, and the Arkiv key disclosure opened.
  await rec(human, 'plan', theme, async (page) => {
    await page.goto(planUrl);
    await page.getByRole('meter', { name: 'Data left' }).waitFor();
    await hold(page, 2500);
    await scrollTo(page, page.getByRole('meter', { name: 'Data left' }), 1600);
    const summary = page.locator('.plan__expiry ~ details.disclosure summary').first();
    await summary.tap();
    await hold(page, 600);
    await scrollTo(page, page.getByTestId('arkiv-key'), 2600);
    await smoothScroll(page, 0, 1500);
  });
  // `/install` (iPhone UA) — the iOS 17.4+ universal link state, "Didn't open? Tap again", the steps.
  await rec(human, 'install-ios', theme, async (page) => {
    await page.goto(`${WEB}/install`);
    await page.getByTestId('ios-universal-link').waitFor();
    await hold(page, 3000);
    await scrollTo(page, page.getByText("Didn't open? Tap again", { exact: false }).first(), 2400);
    await smoothScroll(page, 0, 1200);
  });
  // `/pay?key=` — the eight-state sheet: Review → approve (demo wallet signs) → Sending · hash → Confirmed → Final.
  await rec(human, 'pay', theme, async (page) => {
    await page.goto(`${WEB}/pay?key=${encodeURIComponent(key)}`);
    const sheet = page.locator('.onchain-action');
    await sheet.getByRole('button', { name: 'Pay $0.40 USDC' }).waitFor();
    await hold(page, 3000);
    await sheet.getByRole('button', { name: 'Pay $0.40 USDC' }).tap();
    await page.locator('.onchain-action[data-state="finalized"]').waitFor({ timeout: 30_000 });
    await hold(page, 3500);
  });
  // `/plan/[key]` after the top-up — the meter extended once, 400 MB total.
  await rec(human, 'plan-topped', theme, async (page) => {
    await page.goto(planUrl);
    await page.getByRole('meter', { name: 'Data left' }).waitFor();
    await hold(page, 2000);
    await scrollTo(page, page.getByRole('meter', { name: 'Data left' }), 3500);
  });
  // `/agent` — the policy sentence, cap stepper → a signed save → back to ≤ $10 / day, saved again.
  await rec(human, 'agent', theme, async (page) => {
    await page.goto(`${WEB}/agent`);
    const sentence = page.getByTestId('agent-sentence');
    await sentence.waitFor();
    await hold(page, 2500);
    const cap = page.getByTestId('agent-cap');
    await cap.getByRole('radio', { name: '≤ $5 / day' }).tap();
    await page.getByTestId('agent-status').filter({ hasText: /^Saved/ }).waitFor();
    await hold(page, 1800);
    await cap.getByRole('radio', { name: '≤ $10 / day' }).tap();
    await sentence.filter({ hasText: 'up to $10.00 a day' }).waitFor();
    await page.getByTestId('agent-status').filter({ hasText: /^Saved/ }).waitFor();
    await hold(page, 2500);
  });
  // `/gift` — Who gets it? → rahul.eth resolves → 1 GB → the reclaim rule → Pay → the boarding pass.
  const gift = await rec(human, 'gift', theme, async (page) => {
    await page.goto(`${WEB}/gift`);
    await page.getByRole('heading', { name: 'Who gets it?' }).waitFor();
    await hold(page, 1500);
    await slowType(page.getByTestId('gift-name'), 'rahul.eth');
    await page.getByTestId('gift-resolution').filter({ hasText: 'resolves' }).waitFor();
    await hold(page, 1200);
    await page.getByRole('radio', { name: /^1\sGB · \$4\.00$/ }).tap();
    await hold(page, 900);
    await scrollTo(page, page.getByTestId('gift-rule'), 1800);
    const sheet = page.locator('.onchain-action');
    await sheet.getByRole('button', { name: /^Pay \$/ }).tap();
    const result = page.getByTestId('gift-result');
    await result.waitFor({ timeout: 30_000 });
    await hold(page, 800);
    await scrollTo(page, page.locator('.boarding-pass'), 4200);
    const href = await result.getByRole('link', { name: 'Claim a gift' }).getAttribute('href');
    return { claimHref: href ?? '/gift/claim' };
  });
  // `/receipts` — per-day three-line receipts of the claim, the top-up and the gift.
  await rec(human, 'receipts', theme, async (page) => {
    await page.goto(`${WEB}/receipts`);
    await page.locator('.screen__title').waitFor();
    await hold(page, 3000);
    await smoothScroll(page, 420, 2400);
    await smoothScroll(page, 0, 1500);
  });
  await human.close();

  // `/gift/claim` — the recipient (demo wallet · Anvil #9 = rahul.eth) claims by signature, no payment.
  const recipient = await newContext(browser, theme);
  await rec(recipient, 'gift-claim', theme, async (page) => {
    await page.goto(new URL(gift.claimHref, WEB).toString());
    const button = page.getByTestId('claim-by-signature');
    await button.waitFor();
    await hold(page, 3000);
    await button.tap();
    await page.waitForURL(/\/plan\/.+/, { timeout: 30_000 });
    await page.locator('#plan-coupon .coupon__value').waitFor();
    await hold(page, 3500);
  });
  await recipient.close();

  // `/install` (Android UA) — the copy-code state: Copy activation code → Copied, the Settings steps.
  const android = await newContext(browser, theme, { ua: ANDROID });
  await android.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: WEB });
  await rec(android, 'claim-android', theme, claim, { keep: false });
  await rec(android, 'install-android', theme, async (page) => {
    await page.goto(`${WEB}/install`);
    const copy = page.getByTestId('copy-activation-code');
    await copy.waitFor();
    await hold(page, 2500);
    await copy.tap();
    await copy.filter({ hasText: /Copied/ }).waitFor();
    await hold(page, 1500);
    await scrollTo(page, page.getByText('Settings → Network & internet → SIMs'), 2400);
    await smoothScroll(page, 0, 1200);
  });
  await android.close();

  // `/card/[serial]` — a seeded campaign card, UI in Hindi (the latex reads यहाँ रगड़ें): PIN, scratch ~45 %, Redeem.
  const cards = JSON.parse(readFileSync(process.env.CARDS_FILE ?? join(ROOT, '.e2e/cards.json'), 'utf8'));
  const holder = await newContext(browser, theme, { lang: 'hi' });
  let card;
  for (const c of cards) {
    const res = await holder.request.get(`${API}/card/${c.serial}`);
    if (res.ok() && (await res.json()).state === 'open') {
      card = c;
      break;
    }
  }
  if (!card) throw new Error('.e2e/cards.json has no unredeemed card left: run the demo seed');
  await rec(holder, 'card', theme, async (page) => {
    await page.goto(`${WEB}/card/${card.serial}`);
    await page.getByTestId('card-state').waitFor();
    await hold(page, 2000);
    await slowType(page.getByTestId('card-pin'), card.pin.replace(/(\d{4})(?=\d)/g, '$1 '));
    await page.keyboard.press('Enter');
    const canvas = page.locator('.scratch canvas, canvas').first();
    await canvas.waitFor();
    await scrollTo(page, canvas, 900);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no scratch canvas');
    // A thumb's strokes, left-right across the panel, until ≈ 45 % is cleared and the rest fades.
    await page.mouse.move(box.x + 6, box.y + 6);
    await page.mouse.down();
    const redeem = page.getByTestId('card-redeem');
    for (let y = 6; y < box.height; y += 14) {
      await page.mouse.move(box.x + box.width - 6, box.y + y, { steps: 14 });
      await page.mouse.move(box.x + 6, box.y + y + 7, { steps: 14 });
      if (await redeem.isEnabled()) break;
    }
    await page.mouse.up();
    await redeem.and(page.locator(':enabled')).waitFor({ timeout: 8_000 });
    await hold(page, 1600);
    await redeem.tap();
    await page.waitForURL(/\/plan\/.+/, { timeout: 30_000 });
    await page.locator('#plan-coupon .coupon__value').waitFor();
    await hold(page, 3000);
  });
  await holder.close();

  // `/sponsor/[id]` — the tables and slide-to-confirm pause (DataDrop.pause from Anvil #3), then resume, so the
  // shared local campaign keeps answering claims.
  const plans = await (await browser.newContext()).request.get(`${API}/plans`);
  const campaignId = (await plans.json()).campaign?.id;
  if (!campaignId) throw new Error('GET /plans has no live campaign');
  const sponsor = await newContext(browser, theme);
  await rec(sponsor, 'sponsor', theme, async (page) => {
    await page.goto(`${WEB}/sponsor/${campaignId}`);
    await page.getByTestId('sponsor-claims').waitFor();
    await hold(page, 3000);
    await scrollTo(page, page.getByTestId('claims-table'), 2600);
    const slide = page.getByTestId('slide-to-confirm');
    await scrollTo(page, slide, 1200);
    await slide.fill('100');
    await page.locator('.pill').filter({ hasText: 'Paused' }).waitFor({ timeout: 30_000 });
    await hold(page, 1500);
    // the hero's pill now reads Paused: show it, then resume from the controls
    await smoothScroll(page, 0, 3000);
    const resume = page.getByRole('button', { name: 'Resume claims' });
    await scrollTo(page, resume, 1200);
    await resume.tap();
    await page.locator('.pill').filter({ hasText: 'Paused' }).waitFor({ state: 'detached', timeout: 30_000 }).catch(() => undefined);
    await hold(page, 1500);
  });
  await sponsor.close();
  if (theme === 'light') {
    // the judge video's EvidencePane is 1200 × 900: the same route on a laptop viewport
    const desk = await newContext(browser, theme, { mobile: false, size: { width: 1200, height: 900 }, ua: undefined });
    await rec(desk, 'sponsor-desktop', theme, async (page) => {
      await page.goto(`${WEB}/sponsor/${campaignId}`);
      await page.getByTestId('sponsor-claims').waitFor();
      await hold(page, 3000);
      await scrollTo(page, page.getByTestId('claims-table'), 3000);
      await smoothScroll(page, 0, 1500);
    });
    await desk.close();
  }
}

mkdirSync(TMP, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  for (const theme of themes) await captureTheme(browser, theme);
} finally {
  await browser.close();
  rmSync(TMP, { recursive: true, force: true });
}
const log = join(OUT, 'captures.json');
let previous = [];
try {
  previous = JSON.parse(readFileSync(log, 'utf8'));
} catch {
  // first run
}
const merged = [
  ...previous.filter((p) => !results.some((r) => r.clip === p.clip && r.theme === p.theme)),
  ...results.map((r) => ({ ...r, capturedAt: new Date().toISOString(), web: WEB, api: API })),
].sort((a, b) => a.file.localeCompare(b.file));
writeFileSync(log, `${JSON.stringify(merged, null, 2)}\n`);
console.log(`capture: ${results.length} clip(s) → ${OUT}`);
