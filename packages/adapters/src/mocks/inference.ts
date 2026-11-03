import { sha256Hex } from '../hash.js';

import type { Inference, InferenceOptions, InferenceResult } from '../types.js';

export interface MockInferenceOptions {
  /** Produces the completion text; defaults to a visibly mocked echo of the prompt. */
  respond?: (prompt: string, options: InferenceOptions) => string;
  model?: string;
}

const defaultRespond = (prompt: string): string => `mock completion: ${prompt}`;

/** Deterministic: the same sequence of prompts yields the same texts, request ids and signatures. */
export class MockInference implements Inference {
  readonly #respond: NonNullable<MockInferenceOptions['respond']>;
  readonly #model: string;
  #sequence = 0;

  constructor(options: MockInferenceOptions = {}) {
    this.#respond = options.respond ?? defaultRespond;
    this.#model = options.model ?? 'mock-local';
  }

  async complete(prompt: string, options: InferenceOptions = {}): Promise<InferenceResult> {
    this.#sequence += 1;
    const model = options.model ?? this.#model;
    const text = this.#respond(prompt, options);
    const requestId = await sha256Hex(`request:${this.#sequence}:${model}:${prompt}`);
    const signature = await sha256Hex(`signature:${requestId}:${text}`);
    return { text, requestId, signature, model };
  }
}
