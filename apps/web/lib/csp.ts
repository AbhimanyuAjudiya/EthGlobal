/**
 * Content-Security-Policy (web.md §8, T-58/59/61/76; RT-W-02). Decision: per-request NONCES, set by proxy.ts on
 * every route, with 'strict-dynamic' — no 'unsafe-inline' in script-src. Next reads the nonce from the request's
 * CSP header while rendering and stamps it on its own inline RSC/bootstrap scripts, so the price is dynamic
 * rendering of every page (cacheComponents is off; the pages were client-rendered shells already). A hash list of
 * Next's inline scripts was the alternative: it would keep the static shell, but those scripts carry each page's
 * RSC payload and change with every build and every dynamic hole, so the list could never be complete.
 * An injected `<img onerror>` or `javascript:` URL therefore never runs, even if a future bug renders markup.
 * `require-trusted-types-for` is not set: Turbopack's chunk loader assigns plain strings to `script.src`.
 */
const origin = (url: string | undefined): string | undefined => {
  try {
    return url ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
};

/** 128 random bits, base64 — unguessable and unique per response. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function contentSecurityPolicy(nonce: string, dev = false): string {
  const connect = [
    "'self'",
    origin(process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8787'),
    origin(process.env.NEXT_PUBLIC_ANVIL_RPC_URL ?? 'http://127.0.0.1:8545'),
    'https://*.worldcoin.org',
    'https://*.world.org',
    origin(process.env.NEXT_PUBLIC_EXPLORER_EVM),
    origin(process.env.NEXT_PUBLIC_EXPLORER_HEDERA ?? 'https://hashscan.io'),
  ].filter(Boolean);
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ''}`,
    // React style={} attributes cannot carry a nonce; styles cannot run script
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connect.join(' ')}`,
    "img-src 'self' data: blob:",
    // the bazaar faces are self-hosted under /_next/static/media (packages/ui/fonts.css)
    "font-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');
}
