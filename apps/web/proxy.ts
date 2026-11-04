import { NextResponse, type NextRequest } from 'next/server';

import { contentSecurityPolicy, newNonce } from './lib/csp';

/**
 * Two jobs, on every route except Next's hashed static files:
 * 1. A fresh CSP nonce per request (RT-W-02, lib/csp.ts). The policy goes on the request, where Next reads the
 *    nonce while rendering, and on the response.
 * 2. /print/cards is not public (T-64): without `?token=` equal to PRINT_TOKEN it answers a bare 404, before any
 *    render, so the route's existence and the cards' serials never leak. Constant-length compare.
 */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const PRINT = /^\/print(\/|$)/;
const isPrint = (pathname: string): boolean => {
  try {
    return PRINT.test(decodeURIComponent(pathname));
  } catch {
    return true; // a malformed escape near /print is treated as /print: 404 without the token
  }
};

export function proxy(request: NextRequest) {
  const csp = contentSecurityPolicy(newNonce(), process.env.NODE_ENV === 'development');
  const print = isPrint(request.nextUrl.pathname);
  if (print) {
    const expected = process.env.PRINT_TOKEN ?? '';
    const token = request.nextUrl.searchParams.get('token') ?? '';
    if (expected.length < 16 || !same(token, expected)) {
      return new NextResponse('Not found', {
        status: 404,
        headers: {
          'content-security-policy': csp,
          'x-robots-tag': 'noindex',
          'cache-control': 'no-store',
        },
      });
    }
  }
  const headers = new Headers(request.headers);
  headers.set('content-security-policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', csp);
  if (print) {
    response.headers.set('x-robots-tag', 'noindex, nofollow');
    response.headers.set('cache-control', 'no-store');
  }
  return response;
}

// Next's hashed static files need no policy (they are not documents); everything else gets one, 404s included.
export const config = { matcher: '/((?!_next/static|_next/image).*)' };
