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

const origin = (url: string | undefined): string | undefined => {
  try {
    return url ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
};
const isDev = process.env.NODE_ENV === 'development';

/**
 * CSP (web.md §8, T-58/59/61). App Router inlines its RSC payload as <script> tags, and nonces would force
 * every page to render per request (losing the cacheComponents static shell), so script-src carries
 * 'unsafe-inline' (Next's documented "without nonces" policy); everything else is as strict as the brief.
 */
function contentSecurityPolicy(): string {
  const connect = [
    "'self'",
    origin(process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8787'),
    origin(process.env.NEXT_PUBLIC_ANVIL_RPC_URL ?? 'http://127.0.0.1:8545'),
    'https://*.worldcoin.org',
    'https://*.world.org',
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
    origin(process.env.NEXT_PUBLIC_EXPLORER_EVM),
    origin(process.env.NEXT_PUBLIC_EXPLORER_HEDERA ?? 'https://hashscan.io'),
  ].filter(Boolean);
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    `connect-src ${connect.join(' ')}`,
    "img-src 'self' data: blob:",
    "font-src 'self' https://fonts.gstatic.com",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');
}

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
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
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    root: repoRoot,
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
