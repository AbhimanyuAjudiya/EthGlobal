import { NextResponse, type NextRequest } from 'next/server';

/**
 * /print/cards is not public (T-64): without `?token=` equal to PRINT_TOKEN it answers a bare 404, before any
 * render, so the route's existence and the cards' serials never leak. Constant-length compare.
 */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function proxy(request: NextRequest) {
  const expected = process.env.PRINT_TOKEN ?? '';
  const token = request.nextUrl.searchParams.get('token') ?? '';
  if (expected.length < 16 || !same(token, expected)) {
    return new NextResponse('Not found', {
      status: 404,
      headers: { 'x-robots-tag': 'noindex', 'cache-control': 'no-store' },
    });
  }
  const response = NextResponse.next();
  response.headers.set('x-robots-tag', 'noindex, nofollow');
  response.headers.set('cache-control', 'no-store');
  return response;
}

export const config = { matcher: '/print/:path*' };
