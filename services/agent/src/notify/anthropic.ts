/**
 * Optional notification phrasing with Anthropic (LLM_PROVIDER=anthropic). Implements the `Inference` port so tests use
 * MockInference. The request carries one user message (the fixed instruction + facts JSON from notify.ts), no system
 * prompt from data, and **no tools** (T-84). Nothing in the decision path imports this file.
 *
 * Why raw HTTP instead of `@anthropic-ai/sdk`: ARCHITECTURE §4 allows exactly one HTTP client in this repo
 * (`@ethglobal/protocol/http`, which owns timeouts, zod-validated responses and the bare-`fetch` ban), and the
 * phrasing call is a single non-streaming Messages request with ≤ 80 output tokens. The SDK would add a second fetch
 * path and a fast-moving dependency behind the 3-day release-age rule. If this grows beyond one call shape, switch
 * to the SDK rather than extending this file.
 *
 * Model guidance (docs/ONSITE-RUNBOOK.md): `AGENT_LLM_MODEL=claude-opus-5-5`. Thinking is adaptive by default on that
 * model and cannot be disabled; `output_config.effort: "low"` keeps a one-sentence rewrite cheap. A `refusal` or
 * `max_tokens` stop reason is reported as an error so the caller falls back to the fixed template — that template is
 * the fallback here, so the server-side `fallbacks` parameter is deliberately not used (it would cost a second model
 * call to produce a notification we can already render without a model).
 */
import { z } from 'zod';

import type { Inference, InferenceOptions, InferenceResult } from '@ethglobal/adapters';
import { httpJson } from '@ethglobal/protocol/http';

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
/** Effort for the phrasing call: a one-sentence rewrite of seven numbers needs no deep reasoning. */
export const PHRASING_EFFORT = 'low';

const messageSchema = z
  .object({
    id: z.string().max(200),
    model: z.string().max(200),
    stop_reason: z.string().max(40).nullable().optional(),
    content: z
      .array(z.object({ type: z.string(), text: z.string().max(4_000).optional() }).loose())
      .max(16),
  })
  .loose();

/** Thrown when the model stopped for a reason that makes its text unusable; the notifier falls back to the template. */
export class PhrasingUnavailableError extends Error {
  constructor(readonly stopReason: string) {
    super(`phrasing unavailable: stop_reason=${stopReason}`);
    this.name = 'PhrasingUnavailableError';
  }
}

/** Stop reasons after which the returned text must not be shown (declined, or cut off mid-sentence). */
const UNUSABLE_STOP_REASONS = new Set(['refusal', 'max_tokens']);

export class AnthropicPhraser implements Inference {
  constructor(
    private readonly opts: { apiKey: string; model: string; fetch?: typeof fetch; url?: string },
  ) {}

  async complete(prompt: string, options: InferenceOptions = {}): Promise<InferenceResult> {
    const model = options.model ?? this.opts.model;
    const { data } = await httpJson(this.opts.url ?? ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: { 'x-api-key': this.opts.apiKey, 'anthropic-version': '2023-06-01' },
      body: {
        model,
        max_tokens: options.maxTokens ?? 80,
        output_config: { effort: PHRASING_EFFORT },
        messages: [{ role: 'user', content: prompt }],
      },
      schema: messageSchema,
      timeoutMs: 10_000,
      ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}),
    });
    if (data.stop_reason && UNUSABLE_STOP_REASONS.has(data.stop_reason)) {
      throw new PhrasingUnavailableError(data.stop_reason);
    }
    const text = data.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join(' ');
    return { text, requestId: data.id, signature: '0x', model: data.model };
  }
}
