import { assertTopicMessage } from '../consensus-rules.js';

import type { ConsensusLog } from '../types.js';

export interface MockConsensusLogOptions {
  now?: () => number;
}

/** HCS stand-in: sequence per topic from 1, consensusAt = now, txId `mock@<seq>`; > 1024 bytes rejected (T-44). */
export class MockConsensusLog implements ConsensusLog {
  readonly #now: () => number;
  readonly #topics = new Map<string, { message: string; consensusAt: number }[]>();

  constructor(options: MockConsensusLogOptions = {}) {
    this.#now = options.now ?? Date.now;
  }

  async submit(
    topic: string,
    message: string,
  ): Promise<{ sequence: number; consensusAt: number; txId: string }> {
    assertTopicMessage(topic, message);
    const log = this.#topics.get(topic) ?? [];
    this.#topics.set(topic, log);
    const consensusAt = this.#now();
    log.push({ message, consensusAt });
    return { sequence: log.length, consensusAt, txId: `mock@${log.length}` };
  }

  async read(
    topic: string,
    fromSequence = 1,
  ): Promise<{ sequence: number; message: string; consensusAt: number }[]> {
    return (this.#topics.get(topic) ?? [])
      .map((m, i) => ({ sequence: i + 1, ...m }))
      .filter((m) => m.sequence >= fromSequence);
  }

  /** Every message submitted to `topic`, in order (the wave-2 dump source, L5). */
  messages(topic: string): readonly string[] {
    return (this.#topics.get(topic) ?? []).map((m) => m.message);
  }
}
