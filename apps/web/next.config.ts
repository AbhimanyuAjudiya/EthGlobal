import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { NextConfig } from 'next';

// next.config.ts is compiled to CommonJS by Next, so __dirname is the app directory.
const repoRoot = path.join(__dirname, '../..');

// One .env at the repo root serves every package (see .env.example). Next only reads apps/web/.env*, so the
// root file is loaded here, before NEXT_PUBLIC_* values are inlined. Variables already set in the shell win.
try {
  process.loadEnvFile(path.join(repoRoot, '.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

// MODE=local: the sponsor console's DataDrop falls back to the dev chain's deploy record (packages/contracts/deploy/
// addresses.anvil.json — git-ignored, written by `pnpm dev:chain`). It is filled into NEXT_PUBLIC_DATADROP_ADDRESS here,
// never imported from lib/, so a clone without it still builds and a live bundle cannot carry it (RT-W-12). Read once,
// when the build or dev server starts: start the chain first, or restart `next dev`. An explicit value wins.
if (process.env.NEXT_PUBLIC_MODE === 'local' && !process.env.NEXT_PUBLIC_DATADROP_ADDRESS) {
  try {
    const anvil = JSON.parse(
      readFileSync(path.join(repoRoot, 'packages/contracts/deploy/addresses.anvil.json'), 'utf8'),
    ) as { dataDrop?: string };
    if (anvil.dataDrop) process.env.NEXT_PUBLIC_DATADROP_ADDRESS = anvil.dataDrop;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

const nextConfig: NextConfig = {
  // Another session may be serving `.next`; a verification build goes to NEXT_DIST_DIR (e.g. .next-fix).
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  poweredByHeader: false,
  // The Content-Security-Policy is per request, with a nonce: proxy.ts + lib/csp.ts (RT-W-02). The rest is static.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
  // Self-contained server bundle for containers: .next/standalone/apps/web/server.js
  output: 'standalone',
  outputFileTracingRoot: repoRoot,
  // @ethglobal/ui ships TypeScript source; Next compiles it alongside the app.
  transpilePackages: ['@ethglobal/ui'],
  // No cacheComponents / partial prerendering: a nonce-based CSP needs every document rendered per request
  // (a prerendered shell's inline scripts could never carry the request's nonce). See lib/csp.ts.
  turbopack: {
    root: repoRoot,
    // RT-W-11: the browser gets a throwing stand-in for idkit-core's re-exported RP signer (lib/idkit-server.browser.ts)
    resolveAlias: {
      // nosemgrep: recharge-rp-signing-key-in-client — this alias is the guard: it keeps the signer out of the browser
      '@worldcoin/idkit-server': { browser: './lib/idkit-server.browser.ts' },
    },
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
