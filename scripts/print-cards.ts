/**
 * scripts/print-cards.ts — the scratch-card print run (ops-demo §4, web.md §6). Renders the print sheet of apps/web
 * with Playwright/Chromium to `out/cards-<date>.pdf` (N coupon pages at 91.6 × 59.98 mm + 1 keyline page for the
 * latex vendor), draws every QR with a real encoder (uqr, ECC M, `https://<host>/card/<serial>`), asserts the page
 * count, and writes `out/cards-<date>.manifest.json` (serial → MB, **no PINs**). The PDF carries PINs: `out/` is
 * git-ignored, and the script says so.
 *
 *   pnpm print:cards                         # .e2e/cards.json from demo-seed.ts (real, redeemable local cards)
 *   pnpm print:cards -- --input cards.json   # Thursday: the live campaign-funded cards (serial, pin, mb)
 *   pnpm print:cards -- --count 10           # dry run / printer proof: fake Verhoeff-valid PINs, nothing redeemable
 *   WEB_URL=http://127.0.0.1:3000 pnpm print:cards -- --count 10   # use a running web app instead of starting one
 *
 * Route: `/print/cards?token=<PRINT_TOKEN>&count=N` when apps/web ships it (web.md §2): the PINs reach the server
 * through a one-time 0600 temp file named by PRINT_CARDS_FILE, never through a public route, and the script starts
 * that web process itself. Until then it falls back to the tooling route `/ui/print?side=front&layout=single` (+ its
 * keyline side), which renders the gallery's own demo PINs (≤ 20 cards): good for the printer proof, refused for
 * real cards unless `--proof` says "I know these PINs are not the seeded ones".
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { chromium, type Page } from '@playwright/test';
import { encode } from 'uqr';

import { randomBytes } from '@ethglobal/crypto';
import { generatePin } from '@ethglobal/protocol/pin';

import { answers, ROOT, startWeb, stopAll } from './lib/harness.js';

interface Card {
  serial: string;
  pin: string;
  mb: number;
}

const FALLBACK_MAX = 20;
const { values: flags } = parseArgs({
  options: {
    input: { type: 'string' },
    count: { type: 'string' },
    out: { type: 'string', default: join(ROOT, 'out') },
    proof: { type: 'boolean', default: false },
    port: { type: 'string', default: '3100' },
  },
});

/** One SVG path per dark module (ECC M, no quiet zone: the coupon's keyline is the quiet zone). */
export function qrSvg(url: string, label: string): string {
  const qr = encode(url, { ecc: 'M', border: 0 });
  let d = '';
  qr.data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) d += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${qr.size} ${qr.size}" role="img" ` +
    `aria-label="${label.replace(/"/g, '&quot;')}" data-qr-url="${url}" data-qr-encoder="uqr" ` +
    `shape-rendering="crispEdges"><path fill="#000" d="${d}"/></svg>`
  );
}

function loadCards(): { cards: Card[]; dryRun: boolean } {
  if (flags.count !== undefined) {
    const n = Number.parseInt(flags.count, 10);
    if (!Number.isSafeInteger(n) || n < 1 || n > 500) throw new Error('--count must be 1…500');
    const cards = Array.from({ length: n }, (_, i) => ({
      serial: `d0${i.toString(16).padStart(6, '0')}`,
      pin: generatePin(randomBytes),
      mb: 300,
    }));
    return { cards, dryRun: true };
  }
  const input = flags.input ?? join(ROOT, '.e2e', 'cards.json');
  if (!existsSync(input))
    throw new Error(`${input} missing: run pnpm demo:seed, or pass --count N`);
  return { cards: JSON.parse(readFileSync(input, 'utf8')) as Card[], dryRun: false };
}

/** Replaces each QR slot (`svg[data-qr-url]` without an encoder) with the encoded code, sized like the slot. */
async function drawQrCodes(page: Page): Promise<number> {
  const slots = await page.$$eval('svg[data-qr-url]:not([data-qr-encoder])', (nodes) =>
    nodes.map((n) => ({
      url: n.getAttribute('data-qr-url') ?? '',
      label: n.getAttribute('aria-label') ?? '',
    })),
  );
  const svgs = slots.map((s) => qrSvg(s.url, s.label));
  await page.$$eval(
    'svg[data-qr-url]:not([data-qr-encoder])',
    (nodes, replacements) =>
      nodes.forEach((node, i) => {
        const holder = document.createElement('div');
        holder.innerHTML = replacements[i] ?? '';
        const svg = holder.firstElementChild;
        if (!svg) return;
        for (const attr of ['class', 'style', 'width', 'height']) {
          const value = node.getAttribute(attr);
          if (value !== null) svg.setAttribute(attr, value);
        }
        node.replaceWith(svg);
      }),
    svgs,
  );
  return svgs.length;
}

const pageCount = (pdf: Buffer): number =>
  (pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length;

async function main(): Promise<void> {
  const { cards, dryRun } = loadCards();
  const hasPrintRoute = existsSync(join(ROOT, 'apps/web/app/print/cards/page.tsx'));
  if (!hasPrintRoute && !dryRun && !flags.proof) {
    throw new Error(
      'apps/web has no /print/cards route yet: the fallback /ui/print renders demo PINs, not these cards. ' +
        'Use --count N for a printer proof, or --proof to print the fallback sheet knowingly.',
    );
  }
  const count = hasPrintRoute ? cards.length : Math.min(cards.length, FALLBACK_MAX);
  if (count < cards.length)
    console.warn(
      `print-cards: the fallback route renders at most ${FALLBACK_MAX} cards; printing ${count}`,
    );

  const token = process.env.PRINT_TOKEN ?? `local-${Buffer.from(randomBytes(12)).toString('hex')}`;
  const secretDir = mkdtempSync(join(tmpdir(), 'recharge-print-'));
  const cardsFile = join(secretDir, 'cards.json');
  writeFileSync(cardsFile, JSON.stringify(cards), { mode: 0o600 });

  let webUrl = process.env.WEB_URL;
  const started = performance.now();
  try {
    if (hasPrintRoute || webUrl === undefined || !(await answers(`${webUrl}/`))) {
      // the PIN file only reaches a web process this script starts (PRINT_CARDS_FILE is read server-side)
      webUrl = (
        await startWeb(process.env.API_URL ?? 'http://127.0.0.1:8787', Number(flags.port), {
          PRINT_TOKEN: token,
          PRINT_CARDS_FILE: cardsFile,
        })
      ).webUrl;
    }
    const front = hasPrintRoute
      ? `${webUrl}/print/cards?token=${encodeURIComponent(token)}&count=${count}`
      : `${webUrl}/ui/print?side=front&layout=single&count=${count}`;
    // Playwright's own Chromium; a system Chrome (CHROME_PATH) when that revision is not installed
    const browser = await chromium
      .launch()
      .catch(() =>
        chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome' }),
      );
    try {
      const page = await browser.newPage();
      const res = await page.goto(front, { waitUntil: 'networkidle' });
      if (res?.status() !== 200) throw new Error(`GET ${front.split('?')[0]} → ${res?.status()}`);
      if (!hasPrintRoute) {
        // the fallback's keyline side is a separate route: move its sheet into this document as the last page
        const keyline = await browser.newPage();
        await keyline.goto(`${webUrl}/ui/print?side=keyline&layout=single&count=1`, {
          waitUntil: 'networkidle',
        });
        const sheet = await keyline.$eval('section.print-sheet', (n) => n.outerHTML);
        await keyline.close();
        await page.$eval(
          '.print-root',
          (root, html) => root.insertAdjacentHTML('beforeend', html),
          sheet,
        );
      }
      const drawn = await drawQrCodes(page);
      await page.evaluate(() => document.fonts.ready);
      mkdirSync(flags.out, { recursive: true });
      const date = new Date().toISOString().slice(0, 10);
      const stem = join(flags.out, `cards-${date}${dryRun ? '-proof' : ''}`);
      const pdf = await page.pdf({
        preferCSSPageSize: true,
        printBackground: true,
        path: `${stem}.pdf`,
      });
      const pages = pageCount(pdf);
      if (pages !== count + 1)
        throw new Error(`PDF has ${pages} pages, want ${count} coupons + 1 keyline`);
      const manifest = {
        generatedAt: new Date().toISOString(),
        route: hasPrintRoute ? '/print/cards' : '/ui/print (fallback: demo PINs)',
        dryRun,
        pages,
        qrEncoder: 'uqr@0.1.3 ECC M',
        cards: (hasPrintRoute ? cards.slice(0, count) : []).map(({ serial, mb }) => ({
          serial,
          mb,
        })),
      };
      writeFileSync(`${stem}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
      console.log(
        `print-cards: ${stem}.pdf — ${pages} pages (${count} coupons + 1 keyline), ${drawn} QR codes drawn, ` +
          `${Math.round(performance.now() - started)} ms; manifest without PINs at ${stem}.manifest.json`,
      );
      console.log(
        'print-cards: the PDF holds PINs — out/ is git-ignored; hand it to the printer, then delete it.',
      );
    } finally {
      await browser.close();
    }
  } finally {
    rmSync(secretDir, { recursive: true, force: true });
    stopAll();
  }
}

main().catch((error: unknown) => {
  console.error(`print-cards: ${error instanceof Error ? error.message : String(error)}`);
  stopAll();
  process.exit(1);
});
