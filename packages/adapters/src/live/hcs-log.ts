/**
 * HcsLog (INTERFACES §3.3; A-22; T-44): HCS topic receipts. submit via the Hedera SDK (HederaClientLike), read via
 * the mirror REST API `GET {mirror}/api/v1/topics/{topic}/messages?sequencenumber=gte:N&limit=100&order=asc`.
 */
import { z } from 'zod';

import { httpJson } from '@ethglobal/protocol/http';

import { assertTopic, assertTopicMessage } from '../consensus-rules.js';
import { AdapterError } from '../errors.js';
import { guard } from './errors.js';
import { checkedBaseUrl, joinUrl, withFetch } from './http.js';

import type { ConsensusLog } from '../types.js';
import type { HederaClientLike } from './hedera-sdk.js';

export const HEDERA_TESTNET_MIRROR = 'https://testnet.mirrornode.hedera.com';

const page = z.object({
  messages: z
    .array(
      z
        .object({
          consensus_timestamp: z.string().regex(/^\d{1,12}\.\d{1,9}$/),
          message: z.base64(),
          sequence_number: z.int().positive(),
          topic_id: z.string().optional(),
        })
        .loose(),
    )
    .max(100),
  links: z
    .object({ next: z.string().max(1000).nullish() })
    .loose()
    .optional(),
});

/** Mirror `seconds.nanos` → ms. */
export const consensusMs = (timestamp: string): number => {
  const [s, n = '0'] = timestamp.split('.');
  return Number(s) * 1000 + Math.floor(Number(n.padEnd(9, '0')) / 1_000_000);
};

const MAX_PAGES = 50;

export interface HcsLogOptions {
  client: HederaClientLike;
  mirrorUrl: string;
  fetch?: typeof fetch;
}

export class HcsLog implements ConsensusLog {
  readonly #opts: HcsLogOptions;
  readonly #mirror: URL;

  constructor(opts: HcsLogOptions) {
    this.#opts = opts;
    this.#mirror = checkedBaseUrl(opts.mirrorUrl);
  }

  async submit(
    topic: string,
    message: string,
  ): Promise<{ sequence: number; consensusAt: number; txId: string }> {
    assertTopicMessage(topic, message); // > 1024 bytes refused before submission; the SDK would chunk silently
    return guard('consensus', () => this.#opts.client.submitTopicMessage(topic, message));
  }

  async read(
    topic: string,
    fromSequence = 1,
  ): Promise<{ sequence: number; message: string; consensusAt: number }[]> {
    assertTopic(topic);
    const from = Math.max(1, Math.floor(fromSequence));
    let url: string | undefined = joinUrl(
      this.#mirror,
      `/api/v1/topics/${topic}/messages?sequencenumber=gte:${from}&limit=100&order=asc`,
    );
    const out: { sequence: number; message: string; consensusAt: number }[] = [];
    for (let i = 0; url && i < MAX_PAGES; i += 1) {
      const target: string = url;
      const { status, data } = await guard('consensus', () =>
        httpJson(target, { ...withFetch(this.#opts.fetch), allowStatus: [404] }),
      );
      if (status === 404) return out; // a topic the mirror does not know (yet): nothing to read
      const parsed = page.safeParse(data);
      if (!parsed.success)
        throw new AdapterError('consensus', 'invalid_response', 'unexpected mirror page shape');
      for (const m of parsed.data.messages) {
        out.push({
          sequence: m.sequence_number,
          message: new TextDecoder().decode(
            Uint8Array.from(atob(m.message), (c) => c.charCodeAt(0)),
          ),
          consensusAt: consensusMs(m.consensus_timestamp),
        });
      }
      const next = parsed.data.links?.next;
      // links.next is a path on the same mirror; never follow it to another host
      const nextUrl = next ? new URL(next, this.#mirror) : undefined;
      url = nextUrl
        ? joinUrl(
            this.#mirror,
            `${nextUrl.pathname.replace(this.#mirror.pathname.replace(/\/$/, ''), '')}${nextUrl.search}`,
          )
        : undefined;
    }
    return out;
  }
}
