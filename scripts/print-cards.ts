/**
 * scripts/print-cards.ts — the scratch-card print run (ops-demo §4, web.md §6). Renders the print sheet of apps/web
 * with Playwright/Chromium to `out/cards-<date>.pdf` (N coupon pages at 91.6 × 59.98 mm + 1 keyline page for the
 * latex vendor), draws every QR with a real encoder (uqr, ECC M, `https://<host>/card/<serial>`), asserts the page
 * count, and writes `out/cards-<date>.manifest.json` (serial → MB, **no PINs**). The PDF carries PINs: `out/` is
 * git-ignored, and the script says so.
 *
 *   pnpm print:cards                         # .e2e/cards.json from demo-seed.ts (real, redeemable local cards)
 *   pnpm print:cards -- --input cards.json   # re-print a saved batch (serial, pin, mb, expires, sponsor)
 *   API_URL=https://<vps> pnpm print:cards -- --mint 200 --campaign 0x… --mb 300 --save /secure/cards.json
 *                                            # Thursday: mint the live campaign-funded cards through the API
 *                                            # (POST /sponsor/:id/cards, A-43), signed by the sponsor's keystore
 *   pnpm print:cards -- --count 10           # dry run / printer proof: fake Verhoeff-valid PINs, nothing redeemable
 *   WEB_URL=http://127.0.0.1:3000 pnpm print:cards -- --count 10   # use a running web app instead of starting one
 *
 * Route: `/print/cards?token=<PRINT_TOKEN>&count=N` when apps/web ships it (web.md §2): the PINs reach the server
 * through a one-time 0600 temp file named by PRINT_CARDS_FILE, never through a public route, and the script starts
 * that web process itself. Until then it falls back to the tooling route `/ui/print?side=front&layout=single` (+ its
 * keyline side), which renders the gallery's own demo PINs (≤ 20 cards): good for the printer proof, refused for
 * real cards unless `--proof` says "I know these PINs are not the seeded ones".
 *
 * Minting (RT-P-08): `--mint N` asks the API the script points at for N cards of `--campaign`. The request is an
 * EIP-712 `SponsorCards` signed by the campaign's sponsor: against a MODE=local API with the public Anvil sponsor
 * role, against a live API with `cast wallet sign --data --account ${SPONSOR_ACCOUNT:-sponsor}` (the Foundry
 * keystore prompts for its password; no key ever reaches a command line, an env var or this process). The PINs come
 * back once, so they are written to `--save` (0600) BEFORE the PDF is rendered: a failed render can be re-run with
 * `--input <that file>`.
 *
 * PRINT_TOKEN (T-64): an operator-supplied token must be ≥ 43 base64url characters (32 random bytes); the local
 * fallback is 32 CSPRNG bytes. The PIN temp dir is deleted in `finally` and, if this process is SIGKILLed, by the
 * harness watchdog (removeOnDeath).
 *
 * QR origin: `--mint` and `--input` refuse to start without an https:// NEXT_PUBLIC_PUBLIC_ORIGIN (set it in .env
 * BEFORE `pnpm -r run build`: Next can inline NEXT_PUBLIC_* at build time), and every QR on the rendered sheet is
 * checked against it — a web server that never saw the variable renders `http://127.0.0.1:<port>/card/…`. A
 * `--count` proof may run without it (loopback QR codes, and the success line says so).
 */
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { chromium, type Page } from '@playwright/test';
import { encode } from 'uqr';

import { bytesToHex, randomBytes } from '@ethglobal/crypto';
import { httpJson } from '@ethglobal/protocol/http';
import { generatePin } from '@ethglobal/protocol/pin';
import { cardPreviewSchema, sponsorCardsResponseSchema } from '@ethglobal/protocol/schemas';
import {
  rechargeDomain,
  SPONSOR_CARDS_MAX,
  SPONSOR_CARDS_TYPES,
} from '@ethglobal/protocol/typed-data';

import {
  assertQrUrls,
  expiresLabel,
  PUBLIC_ORIGIN_VAR,
  qrOrigin,
  sponsorCardsTypedData,
} from './lib/cards.js';
import {
  answers,
  cliArgs,
  removeOnDeath,
  ROOT,
  startWeb,
  stopAll,
  stopWithParent,
} from './lib/harness.js';
import { roleKey } from './lib/stack.js';

interface Card {
  serial: string;
  pin: string;
  mb: number;
  /** Front of the card, from the mint: "Expires 30 Nov 2026" (the API's claimBy, IST) and the campaign's name. */
  expires?: string;
  sponsor?: string;
}

const FALLBACK_MAX = 20;
const { values: flags } = parseArgs({
  args: cliArgs(),
  options: {
    input: { type: 'string' },
    count: { type: 'string' },
    out: { type: 'string', default: join(ROOT, 'out') },
    proof: { type: 'boolean', default: false },
    port: { type: 'string', default: '3100' },
    mint: { type: 'string' },
    campaign: { type: 'string' },
    mb: { type: 'string', default: '300' },
    save: { type: 'string' },
  },
});

/** T-64: PRINT_TOKEN guards /print/cards; ≥ 32 random bytes = 43 base64url characters. */
export const PRINT_TOKEN_MIN = 43;

function printToken(): string {
  const { PRINT_TOKEN } = process.env;
  if (PRINT_TOKEN === undefined || PRINT_TOKEN === '')
    return Buffer.from(randomBytes(32)).toString('base64url');
  if (PRINT_TOKEN.length < PRINT_TOKEN_MIN || !/^[A-Za-z0-9_-]+$/.test(PRINT_TOKEN))
    throw new Error(
      `PRINT_TOKEN must be ≥ ${PRINT_TOKEN_MIN} base64url characters (32 random bytes): ` +
        "openssl rand -base64 32 | tr '+/' '-_' | tr -d =",
    );
  return PRINT_TOKEN;
}

/** POST /sponsor/:id/cards on API_URL (A-43); the cards land in --save (0600) before anything else happens. */
async function mintCards(): Promise<Card[]> {
  const count = Number.parseInt(flags.mint ?? '', 10);
  const mb = Number.parseInt(flags.mb, 10);
  const campaignId = flags.campaign ?? '';
  if (!Number.isSafeInteger(count) || count < 1 || count > SPONSOR_CARDS_MAX)
    throw new Error(`--mint must be 1…${SPONSOR_CARDS_MAX}`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(campaignId))
    throw new Error('--campaign <bytes32 id> is required with --mint');
  if (flags.save === undefined)
    throw new Error(
      '--save <file> is required with --mint: the PINs are shown once, and must survive a failed render',
    );
  const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:8787';
  const health = (
    await httpJson<{ mode?: string; chainId?: number }>(`${apiUrl}/healthz`, { timeoutMs: 10_000 })
  ).data;
  if (typeof health.chainId !== 'number') throw new Error(`${apiUrl}/healthz has no chainId`);
  const nonce = bytesToHex(randomBytes(32));
  const issuedAt = Date.now();
  let sponsor: string;
  let signature: string;
  if (health.mode === 'local') {
    // the public Anvil sponsor role (adapters/testing): the only key this script ever holds, and only for MODE=local
    const { privateKeyToAccount } = await import('viem/accounts');
    const account = privateKeyToAccount(roleKey('sponsor'));
    sponsor = account.address;
    signature = await account.signTypedData({
      domain: rechargeDomain(health.chainId),
      types: SPONSOR_CARDS_TYPES,
      primaryType: 'SponsorCards',
      message: {
        campaignId: campaignId as `0x${string}`,
        sponsor: account.address,
        count: BigInt(count),
        mb: BigInt(mb),
        nonce,
        issuedAt: BigInt(issuedAt),
      },
    });
  } else {
    // live: the Foundry keystore signs; cast prompts for the password on this terminal
    const account = process.env.SPONSOR_ACCOUNT ?? 'sponsor';
    sponsor = execFileSync('cast', ['wallet', 'address', '--account', account], {
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'inherit'],
    }).trim();
    const dir = mkdtempSync(join(tmpdir(), 'recharge-mint-'));
    try {
      const file = join(dir, 'typed.json');
      writeFileSync(
        file,
        JSON.stringify(
          sponsorCardsTypedData({
            chainId: health.chainId,
            campaignId,
            sponsor,
            count,
            mb,
            nonce,
            issuedAt,
          }),
        ),
        { mode: 0o600 },
      );
      signature = execFileSync(
        'cast',
        ['wallet', 'sign', '--data', '--from-file', file, '--account', account],
        {
          encoding: 'utf8',
          stdio: ['inherit', 'pipe', 'inherit'],
        },
      ).trim();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const reply = await httpJson(`${apiUrl}/sponsor/${campaignId}/cards`, {
    method: 'POST',
    body: { count, mb, auth: { sponsor, nonce, issuedAt, signature } },
    timeoutMs: 600_000,
    allowStatus: [201, 400, 401, 409, 410, 423, 429, 503],
  });
  if (reply.status !== 201)
    throw new Error(
      `POST /sponsor/${campaignId}/cards → ${reply.status} ${JSON.stringify(reply.data)}`,
    );
  const minted = sponsorCardsResponseSchema.parse(reply.data);
  const expires = expiresLabel(minted.claimBy);
  const cards: Card[] = minted.cards.map(({ serial, pin, mb: size }) => ({
    serial,
    pin,
    mb: size,
    expires,
  }));
  const saveTo = flags.save;
  const save = () => {
    writeFileSync(saveTo, `${JSON.stringify(cards, null, 2)}\n`, { mode: 0o600 });
    chmodSync(saveTo, 0o600);
  };
  save();
  console.log(
    `print-cards: minted ${cards.length} × ${mb} MB cards on ${apiUrl} (${expires}); ` +
      `PINs saved 0600 to ${saveTo} — shred it after the printer has the PDF`,
  );
  // the campaign's public name (GET /card/:serial) goes on the front; looked up only once the PINs are on disk
  try {
    const preview = await httpJson(`${apiUrl}/card/${cards[0]?.serial ?? ''}`, {
      timeoutMs: 10_000,
    });
    const { sponsorName } = cardPreviewSchema.parse(preview.data);
    if (sponsorName !== undefined) {
      for (const card of cards) card.sponsor = sponsorName;
      save();
    }
  } catch (error: unknown) {
    console.warn(
      `print-cards: the cards print without a sponsor name (GET /card/<serial>: ${error instanceof Error ? error.message : String(error)})`,
    );
  }
  return cards;
}

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

async function loadCards(): Promise<{ cards: Card[]; dryRun: boolean }> {
  if (flags.mint !== undefined) return { cards: await mintCards(), dryRun: false };
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
  const input = flags.input ?? join(process.env.E2E_OUT ?? join(ROOT, '.e2e'), 'cards.json');
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
  stopWithParent();
  const token = printToken();
  // real cards need the public origin before anything is minted; a --count proof may encode 127.0.0.1 and says so
  const origin = qrOrigin(
    process.env.NEXT_PUBLIC_PUBLIC_ORIGIN,
    flags.mint !== undefined || flags.input !== undefined,
  );
  const { cards, dryRun } = await loadCards();
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

  const secretDir = mkdtempSync(join(tmpdir(), 'recharge-print-'));
  removeOnDeath(secretDir);
  const cardsFile = join(secretDir, 'cards.json');
  writeFileSync(cardsFile, JSON.stringify(cards), { mode: 0o600 });

  let webUrl = process.env.WEB_URL;
  let webLog: string | undefined;
  const started = performance.now();
  try {
    if (hasPrintRoute || webUrl === undefined || !(await answers(`${webUrl}/`))) {
      // the PIN file only reaches a web process this script starts (PRINT_CARDS_FILE is read server-side)
      const web = await startWeb(
        process.env.API_URL ?? 'http://127.0.0.1:8787',
        Number(flags.port),
        { PRINT_TOKEN: token, PRINT_CARDS_FILE: cardsFile },
        // a production build older than the /print/cards route cannot serve it: compile on demand instead
        hasPrintRoute && !existsSync(join(ROOT, 'apps/web/.next/server/app/print/cards'))
          ? 'dev'
          : 'auto',
      );
      webUrl = web.webUrl;
      webLog = web.log;
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
      // the web route draws its own codes (apps/web/components/QrCode.tsx, same uqr pin); the gallery has slots
      if (!hasPrintRoute) await drawQrCodes(page);
      const qrUrls = await page.$$eval('svg[data-qr-url]', (nodes) =>
        nodes.map((n) => n.getAttribute('data-qr-url') ?? ''),
      );
      // a build that never saw the origin renders this sheet on 127.0.0.1: 200 loopback QRs, caught here, not on paper
      if (origin !== undefined) assertQrUrls(qrUrls, origin);
      const drawn = qrUrls.length;
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
          `first QR → ${qrUrls[0] ?? 'none'}` +
          (origin === undefined ? ` (loopback: ${PUBLIC_ORIGIN_VAR} unset, proof only)` : '') +
          `, ${Math.round(performance.now() - started)} ms; manifest without PINs at ${stem}.manifest.json`,
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
    // next's own access log echoes the request line: keep the one-time PRINT_TOKEN out of .e2e/web.log (T-64)
    if (webLog !== undefined && existsSync(webLog))
      writeFileSync(webLog, readFileSync(webLog, 'utf8').replaceAll(token, '<redacted>'));
  }
}

main().catch((error: unknown) => {
  console.error(`print-cards: ${error instanceof Error ? error.message : String(error)}`);
  stopAll();
  process.exit(1);
});
