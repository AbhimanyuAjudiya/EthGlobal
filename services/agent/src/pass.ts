/**
 * The World ID Agent Pass human checkpoint (docs/WORLD_AGENT_PASS.md). When the API refuses a buy with 403
 * `pass_required`, the agent starts the device attempt through the API (`POST /agent/policy/:key/pass/start`; the
 * device code stays in the API), prints the one line a human needs, journals it and writes a small HCS note, then
 * polls `/pass/poll` at the returned interval until the API's backend validation says approved, denied or expired.
 * The buy resumes only on `approved`; nothing is signed while the checkpoint is pending. The wait is bounded by the
 * attempt's `expires_in` (and by a poll count, so a frozen clock cannot spin), so `--once` returns with the skip
 * journaled when nobody acts.
 */
import { sha256Hex } from '@ethglobal/crypto';
import { httpJson } from '@ethglobal/protocol/http';
import { agentPassPollSchema, agentPassStartSchema } from '@ethglobal/protocol/schemas';

import { logEvent, type Log } from './log.js';

import type { Journal } from './journal.js';
import type { ReceiptWriter } from './receipts.js';

export type PassOutcome = 'approved' | 'pass_denied' | 'pass_expired';

export interface PassClientDeps {
  apiUrl: string;
  fetch: typeof fetch;
  now: () => number;
  log: Log;
  journal: Pick<Journal, 'write'>;
  receipts: Pick<ReceiptWriter, 'pass'>;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const STATE_OF: Record<PassOutcome, 'approved' | 'denied' | 'expired'> = {
  approved: 'approved',
  pass_denied: 'denied',
  pass_expired: 'expired',
};

export class PassClient {
  constructor(private readonly deps: PassClientDeps) {}

  async checkpoint(key: string): Promise<PassOutcome> {
    const { deps } = this;
    const ent = sha256Hex(key);
    const base = `${deps.apiUrl}/agent/policy/${encodeURIComponent(key)}/pass`;
    const { data: start } = await httpJson(`${base}/start`, {
      method: 'POST',
      body: {},
      fetch: deps.fetch,
      schema: agentPassStartSchema,
    });
    const url = start.verification_uri_complete ?? start.verification_uri;
    const startedAt = deps.now();
    const deadline = startedAt + start.expires_in * 1000;
    logEvent(
      deps.log,
      'warn',
      'agent.pass',
      { ent, state: 'pending', userCode: start.user_code, url, expiresIn: start.expires_in },
      `agent-pass: open ${url} (code ${start.user_code}) within ${start.expires_in}s`,
    );
    await deps.journal.write({
      at: startedAt,
      ent,
      event: 'pass',
      state: 'pending',
      userCode: start.user_code,
      url,
      expiresAt: deadline,
    });
    await deps.receipts.pass({ key, state: 'pending', code: start.user_code });

    let intervalS = start.interval;
    const maxPolls = Math.ceil(start.expires_in / Math.max(1, intervalS)) + 1;
    let outcome: PassOutcome = 'pass_expired';
    let reason = 'expired_token';
    for (let i = 0; i < maxPolls && deps.now() < deadline; i += 1) {
      await (deps.sleep ?? defaultSleep)(intervalS * 1000);
      const { data: poll } = await httpJson(`${base}/poll`, {
        method: 'POST',
        body: {},
        fetch: deps.fetch,
        schema: agentPassPollSchema,
      });
      if (poll.state === 'pending') {
        intervalS = poll.retryInS ?? intervalS;
        continue;
      }
      outcome =
        poll.state === 'approved'
          ? 'approved'
          : poll.state === 'denied'
            ? 'pass_denied'
            : 'pass_expired';
      reason = poll.reason ?? poll.state;
      break;
    }
    const state = STATE_OF[outcome];
    logEvent(
      deps.log,
      outcome === 'approved' ? 'info' : 'warn',
      'agent.pass',
      { ent, state, reason },
      `agent-pass: ${state}`,
    );
    await deps.journal.write({ at: deps.now(), ent, event: 'pass', state, reason });
    await deps.receipts.pass({ key, state });
    return outcome;
  }
}
