import type { Campaign, Decision, Entitlement } from '@ethglobal/octroi';
import type { Hex } from '@ethglobal/protocol/ids';
import type { PaymentPayload } from '@ethglobal/protocol/schemas';

import type { Release } from './admission.js';
import type { Deps } from './deps.js';
import type { PaidOperation } from './flows/payments.js';
import type { Logger } from './logger.js';
import type { Context } from 'hono';

/** Per-request values set by the middleware chain (brief §2 order). */
export interface Vars {
  deps: Deps;
  requestId: string;
  log: Logger;
  clientIp: string;
  /** The zod-validated body or query of the route. */
  input: unknown;
  /** Decoded once by x402() (brief §8 bug 1). */
  payment: PaymentPayload | undefined;
  /** Already settled, durably bound operation: mutable admission checks cannot charge or strand it again. */
  paidOperation: PaidOperation | undefined;
  paidTarget: Entitlement | undefined;
  sessionPubKey: Hex | undefined;
  /** Set by octroi(). */
  decision: Decision | undefined;
  campaign: Campaign | undefined;
  releaseSlot: Release | undefined;
}

/** @hono/node-server bindings (the socket address the rate limiter and webhook IP check read). */
export interface Bindings {
  incoming?: { socket?: { remoteAddress?: string } };
}

export interface AppEnv {
  Variables: Vars;
  Bindings: Bindings;
}

export type Ctx = Context<AppEnv>;

/** The validated input of the route, typed by the schema the route declared. */
export const inputOf = <T>(c: Ctx): T => c.get('input') as T;
