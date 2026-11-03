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

const nextConfig: NextConfig = {
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
