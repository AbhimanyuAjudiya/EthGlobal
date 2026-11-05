/**
 * The notification seam the tick calls after it has decided (T-55). The tick only stores the returned text; nothing in
 * the decision path (tick, buyer, payers, loop) imports the phrasing module, an Inference adapter or an LLM client —
 * semgrep `recharge-agent-decision-path-imports-inference` enforces it. The model, if any, gets no tools (T-84).
 */
import type { Inference } from '@ethglobal/adapters';

import { AnthropicPhraser } from './notify/anthropic.js';
import { phraseNotification } from './notify/phrase.js';

import type { AgentConfig } from './config.js';
import type { NotificationFacts } from './facts.js';

export { NOTIFY_INSTRUCTION, phraseNotification, templateNotification } from './notify/phrase.js';
export type { NotificationFacts } from './facts.js';

export interface Notifier {
  phrase(facts: NotificationFacts): Promise<string>;
}

/** The port an optional phrasing model implements (MockInference in tests). */
export type PhrasingModel = Inference;

export function createNotifier(
  llm: AgentConfig['llm'],
  opts: { model?: PhrasingModel; fetch?: typeof fetch } = {},
): Notifier & { model?: PhrasingModel } {
  const model =
    opts.model ??
    (llm.provider === 'anthropic'
      ? new AnthropicPhraser({
          apiKey: llm.apiKey,
          model: llm.model,
          ...(opts.fetch ? { fetch: opts.fetch } : {}),
        })
      : undefined);
  return { phrase: (facts) => phraseNotification(facts, model), ...(model ? { model } : {}) };
}
