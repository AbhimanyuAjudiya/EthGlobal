/**
 * Optional notification phrasing with Anthropic (LLM_PROVIDER=anthropic). Implements the `Inference` port so tests use
 * MockInference. The request carries one user message (the fixed instruction + facts JSON from notify.ts), no system
 * prompt from data, and **no tools** (T-84). Nothing in the decision path imports this file.
 */
import { z } from 'zod';

import type { Inference, InferenceOptions, InferenceResult } from '@ethglobal/adapters';
import { httpJson } from '@ethglobal/protocol/http';

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

const messageSchema = z
  .object({
    id: z.string().max(200),
    model: z.string().max(200),
    content: z
      .array(z.object({ type: z.string(), text: z.string().max(4_000).optional() }).loose())
      .max(16),
  })
  .loose();

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
        messages: [{ role: 'user', content: prompt }],
      },
      schema: messageSchema,
      timeoutMs: 10_000,
      ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}),
    });
    const text = data.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join(' ');
    return { text, requestId: data.id, signature: '0x', model: data.model };
  }
}
