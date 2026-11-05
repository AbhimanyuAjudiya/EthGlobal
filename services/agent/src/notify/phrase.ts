/**
 * Notification phrasing (INTERFACES §8; T-55, T-84). The default is a fixed template. With LLM_PROVIDER=anthropic the
 * model sees exactly `NOTIFY_INSTRUCTION + JSON.stringify(facts)` — numbers and one enum, re-built key by key so no
 * other property of the object can ride along — and it gets no tools. Its output is plain text: trimmed, stripped of
 * control characters, cut to 140 characters, logged and shown, and never parsed or fed back into a decision.
 */
import { z } from 'zod';

import type { Inference } from '@ethglobal/adapters';
import { formatUsd6, usd6FromWire } from '@ethglobal/protocol/units';

import type { NotificationFacts } from '../facts.js';

export type { NotificationFacts };

const mb = z.int().nonnegative().max(10_000_000);
const factsSchema = z.strictObject({
  mbRemaining: mb,
  mbTotal: mb,
  expiresAt: z.int().nonnegative(),
  boughtMb: mb,
  spentTodayUsd6: z.string().regex(/^\d{1,30}$/),
  capUsd6: z.string().regex(/^\d{1,30}$/),
  reason: z.enum(['threshold', 'expiry', 'cap', 'paused']),
});

/** The fixed instruction; the facts JSON is appended and nothing else is ever added. */
export const NOTIFY_INSTRUCTION =
  'Rewrite these facts about a mobile-data top-up as one sentence for a phone notification: present tense, no exclamation marks, numbers exactly as given, no other content. Facts: ';
export const MAX_NOTIFICATION_CHARS = 140;

/** Canonical facts JSON in a fixed key order (the exact text the LLM receives after the instruction). */
export function factsJson(facts: NotificationFacts): string {
  const f = factsSchema.parse(facts);
  return JSON.stringify({
    mbRemaining: f.mbRemaining,
    mbTotal: f.mbTotal,
    expiresAt: f.expiresAt,
    boughtMb: f.boughtMb,
    spentTodayUsd6: f.spentTodayUsd6,
    capUsd6: f.capUsd6,
    reason: f.reason,
  });
}

/** The default phrasing: one fixed template per reason, filled with numbers only. */
export function templateNotification(facts: NotificationFacts): string {
  const f = factsSchema.parse(facts);
  const spent = formatUsd6(usd6FromWire(f.spentTodayUsd6));
  const cap = formatUsd6(usd6FromWire(f.capUsd6));
  switch (f.reason) {
    case 'threshold':
    case 'expiry':
      return `+${f.boughtMb} MB · paid by your agent · ${spent} of ${cap} today · ${f.mbRemaining} MB left`;
    case 'cap':
      return `Daily cap reached · ${cap} · resumes 00:00 UTC`;
    case 'paused':
      return 'Agent paused';
  }
}

/** Plain text only: no control or bidi-override characters, single spaces, ≤ 140 chars. */
export function sanitizeNotification(text: string): string {
  const clean = text
    // C0/C1 controls and the bidi embedding/override/isolate marks (U+202A–U+202E, U+2066–U+2069)
    // eslint-disable-next-line no-control-regex -- matching control characters is the point
    .replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [...clean].slice(0, MAX_NOTIFICATION_CHARS).join('');
}

export async function phraseNotification(
  facts: NotificationFacts,
  llm?: Inference,
): Promise<string> {
  const template = templateNotification(facts);
  if (llm === undefined) return template;
  try {
    const { text } = await llm.complete(NOTIFY_INSTRUCTION + factsJson(facts), { maxTokens: 80 });
    const phrased = sanitizeNotification(text);
    return phrased === '' ? template : phrased;
  } catch {
    return template;
  }
}
