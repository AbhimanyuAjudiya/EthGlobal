/**
 * MODE=local only (RT-W-12, T-63): the demo wallet's EIP-1193 transport. Every request goes to the local-only
 * route handler app/api/demo-wallet, which signs with a key derived on the server. Imported only from
 * lib/wallet.ts `connectDemo`, behind a literal `process.env.NEXT_PUBLIC_MODE === 'local'` check, so a live build
 * contains neither this module nor its route path (test/live-bundle.test.ts greps for it).
 */
import { httpJson } from '@ethglobal/protocol/http';

import type { DemoRole, Eip1193 } from '../wallet';

/** Same-origin JSON only: the route refuses cross-site and text/plain requests (RT-W-05). */
export function demoProvider(role: DemoRole): Eip1193 {
  return {
    async request({ method, params }) {
      const res = await httpJson<{ result?: unknown; error?: { code: number; message: string } }>(
        '/api/demo-wallet',
        { body: { role, method, params: params ?? [] }, allowStatus: [400, 403, 404, 415, 500] },
      );
      if (res.data.error || res.status >= 400) {
        const err = new Error(res.data.error?.message ?? `demo wallet ${res.status}`) as Error & {
          code?: number;
        };
        err.code = res.data.error?.code ?? -32603;
        throw err;
      }
      return res.data.result;
    },
  };
}

