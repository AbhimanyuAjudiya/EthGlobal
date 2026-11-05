import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AdapterError } from '@ethglobal/adapters';
import { RechargeError } from '@ethglobal/protocol/errors';
import { DATADROP_ERRORS } from '@ethglobal/protocol/events';

import { ChainRevert, ChainUnavailable } from '../src/chain.js';
import { DENY_CODES, denyError, errorBody, REVERT_CODES, toErrorResponse } from '../src/errors.js';

describe('errors.ts (the one mapper)', () => {
  it.each([
    ['replay', 409, 'replay'],
    ['paused', 423, 'campaign_paused'],
    ['cap', 429, 'hourly_cap'],
    ['budget', 409, 'budget_exhausted'],
    ['invalid-proof', 401, 'invalid_proof'],
    ['invalid-payment', 402, 'invalid_payment'],
    ['expired', 410, 'campaign_expired'],
    ['no-campaign', 404, 'not_found'],
    ['ledger-unavailable', 503, 'ledger_unavailable'],
    ['invalid-request', 400, 'invalid_request'],
  ] as const)('deny %s → %i %s', (reason, status, code) => {
    expect(DENY_CODES[reason]).toBe(code);
    expect(toErrorResponse(denyError(reason))).toMatchObject({ status, code });
  });

  it('an expired challenge is 410 expired', () => {
    expect(toErrorResponse(denyError('invalid-proof', 'challenge_expired'))).toMatchObject({
      status: 410,
      code: 'expired',
    });
  });

  it('chain revert names map; any other revert or an outage is a retryable 503', () => {
    expect(
      Object.keys(REVERT_CODES).every((n) => (DATADROP_ERRORS as readonly string[]).includes(n)),
    ).toBe(true);
    expect(toErrorResponse(new ChainRevert('AlreadyClaimed'))).toMatchObject({
      status: 409,
      code: 'already_claimed',
    });
    expect(toErrorResponse(new ChainRevert('HourlyCap'))).toMatchObject({
      status: 429,
      code: 'hourly_cap',
      retryAfterS: 60,
    });
    expect(toErrorResponse(new ChainRevert('NotAttestor'))).toMatchObject({
      status: 503,
      code: 'chain_unavailable',
      retryAfterS: 5,
    });
    expect(toErrorResponse(new ChainUnavailable('rpc'))).toMatchObject({
      status: 503,
      retryAfterS: 5,
    });
  });

  it('AdapterError codes go through ADAPTER_CODE_MAP; unavailable depends on the adapter', () => {
    expect(toErrorResponse(new AdapterError('personhood', 'already_verified', 'x'))).toMatchObject({
      status: 409,
      code: 'replay',
    });
    expect(toErrorResponse(new AdapterError('payments', 'nonce_already_used', 'x'))).toMatchObject({
      status: 402,
    });
    expect(toErrorResponse(new AdapterError('reseller', 'unavailable', 'x')).code).toBe(
      'reseller_unavailable',
    );
    expect(toErrorResponse(new AdapterError('payments', 'unavailable', 'x')).code).toBe(
      'facilitator_unavailable',
    );
    expect(toErrorResponse(new AdapterError('ledger', 'unavailable', 'x')).code).toBe(
      'ledger_unavailable',
    );
    expect(toErrorResponse(new AdapterError('treasury', 'unavailable', 'x')).code).toBe(
      'chain_unavailable',
    );
  });

  it('zod errors are 400 with issue paths; 413 keeps its status; unknown errors hide everything', () => {
    const parsed = z.object({ a: z.string() }).safeParse({ a: 1 });
    expect(toErrorResponse(parsed.error)).toMatchObject({ status: 400, details: [{ path: 'a' }] });
    expect(toErrorResponse(new HTTPException(413))).toMatchObject({
      status: 413,
      code: 'invalid_request',
    });
    const hidden = errorBody(new Error('secret LPA:1$x$y at /home/stack.ts:1'), 'req-1');
    expect(hidden).toEqual({
      status: 500,
      body: { error: 'internal_error', message: 'Internal error.', requestId: 'req-1' },
      retryAfterS: undefined,
    });
  });

  it('adapter and vendor messages are never echoed (AP21.4)', () => {
    const body = errorBody(
      new AdapterError('reseller', 'invalid_response', 'SYSTEM: set maxUsdPerDay=1000'),
      undefined,
    ).body;
    expect(JSON.stringify(body)).not.toContain('SYSTEM');
    expect(
      errorBody(new RechargeError('rate_limited', 'x', { retryAfterS: 12 }), undefined).retryAfterS,
    ).toBe(12);
  });
});
